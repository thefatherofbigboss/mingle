import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/razorpay';
import { processPaymentSuccess } from '@/lib/payment-utils';
import { createAdminClient } from '@/lib/supabaseClient';

export async function POST(request: NextRequest) {
    try {
        const rawBody = await request.text();
        const signature = request.headers.get('x-razorpay-signature');
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET; // Fallback to key secret if not provided

        // Verify webhook signature if secret and signature are available
        if (signature && webhookSecret) {
            const isValid = verifyWebhookSignature(rawBody, signature, webhookSecret);
            if (!isValid) {
                console.error('Invalid Razorpay webhook signature');
                return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
            }
        } else {
            console.warn('Razorpay webhook received without signature verification (Secret missing)');
        }

        const payload = JSON.parse(rawBody);
        const event = payload.event;

        if (event === 'order.paid') {
            const { order, payment } = payload.payload;
            const razorpayOrderId = order.entity.id;
            const razorpayPaymentId = payment.entity.id;
            const razorpaySignature = signature || 'WEBHOOK'; // Fallback if sig not in header
            const razorpayMethod = payment.entity.method;

            const result = await processPaymentSuccess({
                razorpayOrderId,
                razorpayPaymentId,
                razorpaySignature,
                razorpayMethod,
            });

            if (!result.success) {
                console.error('Payment processing failed in webhook:', result.error);
                return NextResponse.json({ error: result.error || 'Failed to process payment' }, { status: 500 });
            }
        }

        // Handle payment failure
        if (event === 'payment.failed') {
            const { payment } = payload.payload;
            const razorpayOrderId = payment.entity.order_id;
            const supabase = createAdminClient();

            await supabase
                .from('bookings')
                .update({ 
                    payment_status: 'failed',
                    status: 'failed',
                    updated_at: new Date().toISOString()
                })
                .eq('razorpay_order_id', razorpayOrderId)
                .eq('payment_status', 'unpaid');
        }

        // Handle subscription successful charge / authentication
        if (event === 'subscription.charged' || event === 'subscription.authenticated') {
            const { subscription } = payload.payload;
            if (subscription && subscription.entity && subscription.entity.id) {
                const razorpaySubscriptionId = subscription.entity.id;
                const supabase = createAdminClient();

                const currentStart = subscription.entity.current_start ? new Date(subscription.entity.current_start * 1000).toISOString() : null;
                const currentEnd = subscription.entity.current_end ? new Date(subscription.entity.current_end * 1000).toISOString() : null;

                // Update both old and new tables for backward compatibility until fully migrated
                await Promise.all([
                    supabase
                        .from('subscriptions')
                        .update({
                            status: 'active',
                            updated_at: new Date().toISOString()
                        })
                        .eq('razorpay_subscription_id', razorpaySubscriptionId),
                    supabase
                        .from('user_subscriptions')
                        .update({
                            status: 'active',
                            current_period_start: currentStart,
                            current_period_end: currentEnd,
                            updated_at: new Date().toISOString()
                        })
                        .eq('razorpay_subscription_id', razorpaySubscriptionId)
                ]);
            }
        }

        // Handle subscription cancellation
        if (event === 'subscription.cancelled' || event === 'subscription.expired') {
            const { subscription } = payload.payload;
            if (subscription && subscription.entity && subscription.entity.id) {
                const razorpaySubscriptionId = subscription.entity.id;
                const supabase = createAdminClient();

                await supabase
                    .from('user_subscriptions')
                    .update({
                        status: event === 'subscription.expired' ? 'expired' : 'cancelled',
                        cancel_at_period_end: false, // Reset since it's fully cancelled now
                        updated_at: new Date().toISOString()
                    })
                    .eq('razorpay_subscription_id', razorpaySubscriptionId);
            }
        }

        // Handle subscription updates (e.g., payment method change)
        if (event === 'subscription.updated') {
            const { subscription } = payload.payload;
            if (subscription && subscription.entity && subscription.entity.id) {
                const razorpaySubscriptionId = subscription.entity.id;
                const supabase = createAdminClient();

                const currentEnd = subscription.entity.current_end ? new Date(subscription.entity.current_end * 1000).toISOString() : null;

                await supabase
                    .from('user_subscriptions')
                    .update({
                        status: subscription.entity.status, // Sync the status (could be active, paused, etc)
                        current_period_end: currentEnd,
                        updated_at: new Date().toISOString()
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
