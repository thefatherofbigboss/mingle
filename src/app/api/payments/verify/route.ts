import { NextRequest, NextResponse } from 'next/server';
import { verifyRazorpaySignature } from '@/lib/razorpay';
import { processPaymentSuccess } from '@/lib/payment-utils';
import { createServerClient } from '@/lib/supabaseClient';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Verify signature
        const isValid = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
        if (!isValid) {
            return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 });
        }

        const supabase = createServerClient();
        const { data: { user: _user } } = await supabase.auth.getUser();

        const result = await processPaymentSuccess({
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
            razorpaySignature: razorpay_signature
        });

        if (!result.success) {
            return NextResponse.json({ error: result.error || 'Failed to process payment' }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            bookingId: result.bookingId,
            message: 'Payment verified and booking confirmed'
        });

    } catch (error: unknown) {
        console.error('Error verifying payment:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Verification failed' }, { status: 500 });
    }
}
