import { NextRequest, NextResponse } from 'next/server';
import { createRazorpayOrder } from '@/lib/razorpay';
import { findOrCreateUserByContact } from '@/lib/userProfile';
import { getCorsHeaders, handleOptionsResponse } from '@/lib/cors';

export async function OPTIONS(req: NextRequest) {
  return handleOptionsResponse(req);
}

export async function POST(req: NextRequest) {
  const corsHeaders = getCorsHeaders(req);

  try {
    const body = await req.json();
    const { amountInr, credits, userId, email, phone, name } = body;

    const amount = Number(amountInr);
    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Valid amount is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    let resolvedUserId = userId;
    if (email) {
      try {
        const syncedId = await findOrCreateUserByContact({
          email: email.trim().toLowerCase(),
          phone: phone ? phone.replace(/\D/g, '') : undefined,
          name: name ? name.trim() : undefined,
        });
        if (syncedId) resolvedUserId = syncedId;
      } catch (err) {
        console.warn('[CreditsOrder] User sync warning:', err);
      }
    }

    const receipt = `CRD_${Date.now().toString().slice(-8)}`;
    const order = await createRazorpayOrder({
      amount: Math.round(amount * 100), // paise
      currency: 'INR',
      receipt,
      notes: {
        payment_type: 'call_credits',
        user_id: resolvedUserId || '',
        credits: String(credits || amount * 10),
        email: email || '',
        phone: phone || '',
      },
    });

    return NextResponse.json(
      {
        success: true,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
        credits: credits || amount * 10,
      },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    console.error('[CreditsOrder] Error creating order:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to create order' },
      { status: 500, headers: corsHeaders }
    );
  }
}
