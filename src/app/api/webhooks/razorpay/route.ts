import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/razorpay';
import { processPaymentSuccess } from '@/lib/payment-utils';
import { createAdminClient } from '@/lib/supabaseClient';
import { activateSubscription } from '@/lib/activate-subscription';

const SUBSCRIPTION_PAYMENT_EVENTS = new Set([
    'subscription.charged',
    'subscription.authenticated',
    'subscription.activated',
    'subscription.completed',
]);

export async function POST(request: NextRequest) {
    try {
        const rawBody = await request.text();
        const signature = request.headers.get('x-razorpay-signature');
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

        if (signature && webhookSecret) {
            const isValid = verifyWebhookSignature(rawBody, signature, webhookSecret);
            if (!isValid) {
                console.error('[Webhook] Invalid Razorpay webhook signature — check RAZORPAY_WEBHOOK_SECRET in backend env');
                return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
            }
        } else if (signature && !webhookSecret) {
            console.error(
                '[Webhook] x-razorpay-signature present but RAZORPAY_WEBHOOK_SECRET is not set. ' +
                    'Add the webhook secret from Razorpay Dashboard → Webhooks.'
            );
        } else {
            console.warn('[Webhook] Processing without signature verification');
        }

        const payload = JSON.parse(rawBody);
        const event = payload.event;

        if (event === 'order.paid') {
            const { order, payment } = payload.payload;
            const razorpayOrderId = order.entity.id;
            const razorpayPaymentId = payment.entity.id;
            const razorpaySignature = signature || 'WEBHOOK';
            const razorpayMethod = payment.entity.method;

            const result = await processPaymentSuccess({
                razorpayOrderId,
                razorpayPaymentId,
                razorpaySignature,
                razorpayMethod,
            });

            if (!result.success) {
                if (result.error === 'Booking not found') {
                    console.log(
                        `[Webhook] Order ${razorpayOrderId} not found in bookings table. Checking user_subscriptions table.`
                    );
                    const subResult = await activateSubscription({
                        razorpayOrderId,
                        razorpayPaymentId,
                        source: 'webhook',
                    });

                    if (subResult.success) {
                        console.log(`[Webhook] Membership order ${razorpayOrderId} activated successfully via webhook.`);
                        return NextResponse.json({ status: 'success', message: 'Subscription activated via order webhook' });
                    }

                    return NextResponse.json({ status: 'ignored', message: 'Order not found in bookings or subscriptions' });
                }
                console.error('Payment processing failed in webhook:', result.error);
                return NextResponse.json({ error: result.error || 'Failed to process payment' }, { status: 500 });
            }
        }

        if (event === 'payment.failed') {
            const { payment } = payload.payload;
            const razorpayOrderId = payment.entity.order_id;
            const supabase = createAdminClient();

            await supabase
                .from('bookings')
                .update({
                    payment_status: 'failed',
                    status: 'failed',
                    updated_at: new Date().toISOString(),
                })
                .eq('razorpay_order_id', razorpayOrderId)
                .eq('payment_status', 'unpaid');
        }

        if (SUBSCRIPTION_PAYMENT_EVENTS.has(event)) {
            const { subscription, payment } = payload.payload;
            if (subscription?.entity?.id) {
                const razorpaySubscriptionId = subscription.entity.id;
                const razorpayPaymentId = payment?.entity?.id || null;

                console.log(`[Webhook] Activating subscription ${razorpaySubscriptionId} (event: ${event})`);

                const result = await activateSubscription({
                    razorpaySubscriptionId,
                    razorpayPaymentId,
                    source: 'webhook',
                });

                if (!result.success) {
                    console.error(`[Webhook] Activation failed for ${razorpaySubscriptionId}:`, result.error);
                    return NextResponse.json({ error: result.error || 'Activation failed' }, { status: 500 });
                }
            }
        }

        if (event === 'subscription.cancelled' || event === 'subscription.expired') {
            const { subscription } = payload.payload;
            if (subscription?.entity?.id) {
                const razorpaySubscriptionId = subscription.entity.id;
                const supabase = createAdminClient();

                await supabase
                    .from('user_subscriptions')
                    .update({
                        status: event === 'subscription.expired' ? 'expired' : 'cancelled',
                        cancel_at_period_end: false,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('razorpay_subscription_id', razorpaySubscriptionId);
            }
        }

        if (event === 'subscription.updated') {
            const { subscription } = payload.payload;
            if (subscription?.entity?.id) {
                const razorpaySubscriptionId = subscription.entity.id;
                const supabase = createAdminClient();

                const currentEnd = subscription.entity.current_end
                    ? new Date(subscription.entity.current_end * 1000).toISOString()
                    : null;

                await supabase
                    .from('user_subscriptions')
                    .update({
                        status: subscription.entity.status,
                        current_period_end: currentEnd,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('razorpay_subscription_id', razorpaySubscriptionId);
            }
        }

        return NextResponse.json({ status: 'ok' });
    } catch (error: unknown) {
        console.error('Webhook error:', error);
        const message = error instanceof Error ? error.message : 'Webhook processing failed';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
