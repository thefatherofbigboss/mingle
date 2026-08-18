import { NextRequest, NextResponse } from 'next/server';
import { verifyRazorpaySignature, verifyRazorpaySubscriptionSignature } from '@/lib/razorpay';
import { activateSubscription } from '@/lib/activate-subscription';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { 
            razorpay_payment_id, 
            razorpay_order_id, 
            razorpay_subscription_id, 
            razorpay_signature 
        } = body;

        console.log(`[Verify] Processing signature for order: ${razorpay_order_id || razorpay_subscription_id}`);

        if (!razorpay_payment_id || !razorpay_signature || (!razorpay_order_id && !razorpay_subscription_id)) {
            return NextResponse.json({ error: 'Missing required payment verification fields' }, { status: 400 });
        }

        let isValid = false;

        if (razorpay_order_id) {
            // Verify Standard One-Time Razorpay Order signature: HMAC(order_id + "|" + payment_id)
            isValid = verifyRazorpaySignature(
                razorpay_order_id,
                razorpay_payment_id,
                razorpay_signature
            );
        } else if (razorpay_subscription_id) {
            // Legacy Subscription signature verification: HMAC(payment_id + "|" + subscription_id)
            isValid = verifyRazorpaySubscriptionSignature(
                razorpay_subscription_id,
                razorpay_payment_id,
                razorpay_signature
            );
        }

        if (!isValid) {
            console.error('[Verify] Invalid payment signature');
            return NextResponse.json({ error: 'Invalid payment signature' }, { status: 401 });
        }

        const result = await activateSubscription({
            razorpayOrderId: razorpay_order_id || null,
            razorpaySubscriptionId: razorpay_subscription_id || null,
            razorpayPaymentId: razorpay_payment_id,
            source: 'verify',
        });

        if (!result.success) {
            console.error('[Verify] Activation failed:', result.error);
            return NextResponse.json(
                {
                    error: 'Failed to update membership status',
                    details: result.error,
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            message: 'Membership activated. Please verify your email.',
            emailSent: result.emailSent ?? false,
            alreadyActive: result.alreadyActive ?? false,
        });
    } catch (error: unknown) {
        console.error('[Verify] Internal Error:', error);
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
