import { NextRequest, NextResponse } from 'next/server';
import { verifyRazorpaySignature } from '@/lib/razorpay';
import { createAdminClient } from '@/lib/supabaseClient';
import { findOrCreateUserByContact } from '@/lib/userProfile';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      userId,
      email,
      creditsToAdd,
    } = body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return NextResponse.json({ error: 'Missing payment verification details' }, { status: 400 });
    }

    const isValid = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
    if (!isValid) {
      return NextResponse.json({ error: 'Payment signature verification failed' }, { status: 400 });
    }

    const supabase = createAdminClient();
    let resolvedUserId = userId;

    if (!resolvedUserId && email) {
      resolvedUserId = await findOrCreateUserByContact({ email: email.trim().toLowerCase() });
    }

    if (!resolvedUserId && email) {
      const { data: u } = await supabase
        .from('users')
        .select('id')
        .eq('email', email.trim().toLowerCase())
        .maybeSingle();
      if (u) resolvedUserId = u.id;
    }

    if (!resolvedUserId) {
      return NextResponse.json({ error: 'Could not resolve user account' }, { status: 404 });
    }

    const addCredits = Number(creditsToAdd) || 500;

    // Increment user's credits
    const { data: userRow } = await supabase
      .from('users')
      .select('credits')
      .eq('id', resolvedUserId)
      .maybeSingle();

    const currentCredits = userRow?.credits || 0;
    const newCredits = currentCredits + addCredits;

    await supabase
      .from('users')
      .update({
        credits: newCredits,
        updated_at: new Date().toISOString(),
      })
      .eq('id', resolvedUserId);

    console.log(`[CreditsVerify] Added ${addCredits} credits to user ${resolvedUserId}. New total: ${newCredits}`);

    return NextResponse.json({
      success: true,
      creditsAdded: addCredits,
      newBalance: newCredits,
    });
  } catch (err: any) {
    console.error('[CreditsVerify] Error verifying credits payment:', err);
    return NextResponse.json({ error: err.message || 'Payment verification failed' }, { status: 500 });
  }
}
