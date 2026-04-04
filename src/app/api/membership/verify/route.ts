import { NextRequest, NextResponse } from 'next/server';
import { verifyRazorpaySubscriptionSignature, getRazorpaySubscription } from '@/lib/razorpay';
import { createAdminClient } from '@/lib/supabaseClient';
import { v4 as uuidv4 } from 'uuid';
import { sendEmail, generateMembershipVerificationHtml } from '@/lib/email';
import { findOrCreateUserByContact } from '@/lib/userProfile';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { 
            razorpay_payment_id, 
            razorpay_subscription_id, 
            razorpay_signature 
        } = body;

        console.log(`[Verify] Processing signature for sub: ${razorpay_subscription_id}`);

        if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // 1. Verify Signature
        const isValid = verifyRazorpaySubscriptionSignature(
            razorpay_subscription_id,
            razorpay_payment_id,
            razorpay_signature
        );

        if (!isValid) {
            console.error('[Verify] Invalid signature');
            return NextResponse.json({ error: 'Invalid payment signature' }, { status: 401 });
        }

        const supabase = createAdminClient();
        const verificationToken = uuidv4();

        // 2. Fetch initial subscription to get customer details
        const { data: initialSub, error: fetchError } = await supabase
            .from('user_subscriptions')
            .select('*')
            .eq('razorpay_subscription_id', razorpay_subscription_id)
            .maybeSingle();

        if (fetchError || !initialSub) {
            console.error('[Verify] Subscription not found in DB:', razorpay_subscription_id);
            return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
        }

        // 3. Fetch full subscription details from Razorpay to get expiry date
        let currentPeriodEnd = null;
        try {
            const subDetail = await getRazorpaySubscription(razorpay_subscription_id);
            if (subDetail.current_end) {
                currentPeriodEnd = new Date(subDetail.current_end * 1000).toISOString();
            }
        } catch (subErr) {
            console.error('[Verify] Could not fetch sub details from Razorpay:', subErr);
        }

        // 4. User Linking: Find or create a user record for this customer
        let userId = null;
        if (initialSub.customer_email) {
            console.log(`[Verify] Provisioning identity for: ${initialSub.customer_email}`);
            userId = await findOrCreateUserByContact({
                email: initialSub.customer_email,
                phone: initialSub.customer_phone,
                name: initialSub.customer_name
            });
            console.log(`[Verify] Identity linked successfully: ${userId ? userId : 'FAILED'}`);
            
            if (!userId) {
                console.warn(`[Verify] Identity provisioning returned NULL for ${initialSub.customer_email}. Linkage will be deferred to Self-Healing.`);
            }
        }

        // 5. Update subscription status in DB
        const { data: finalSub, error: dbError } = await supabase
            .from('user_subscriptions')
            .update({ 
                status: 'active',
                user_id: userId, // LINKING HAPPENS HERE
                razorpay_payment_id: razorpay_payment_id,
                verification_token: verificationToken,
                current_period_end: currentPeriodEnd,
                is_verified: false,
                updated_at: new Date().toISOString()
            })
            .eq('razorpay_subscription_id', razorpay_subscription_id)
            .select()
            .single();

        if (dbError || !finalSub) {
            console.error('[Verify] Database update error:', {
                error: dbError,
                subscription_id: razorpay_subscription_id,
                payment_id: razorpay_payment_id
            });
            return NextResponse.json({ 
                error: 'Failed to update membership status',
                details: dbError?.message 
            }, { status: 500 });
        }

        // 6. Send Verification Email
        try {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://strangermingle.com';
            const verificationLink = `${appUrl}/verify-membership?token=${verificationToken}`;
            
            console.log(`[Verify] Sending verification email to: ${finalSub.customer_email}`);
            
            await sendEmail({
                to: finalSub.customer_email,
                subject: 'Verify Your Stranger Mingle Membership',
                html: generateMembershipVerificationHtml(finalSub.customer_name, verificationLink),
                from: 'team@strangermingle.com'
            });
            
            console.log(`[Verify] Email sent successfully`);
        } catch (emailErr) {
            // We don't want to fail the whole request if email fails, but we should log it
            console.error('[Verify] Failed to send verification email:', emailErr);
        }

        return NextResponse.json({ 
            success: true, 
            message: 'Membership activated. Please verify your email.' 
        });

    } catch (error: any) {
        console.error('[Verify] Internal Error:', error);
        return NextResponse.json({ 
            success: false, 
            error: error.message || 'Internal Server Error' 
        }, { status: 500 });
    }
}
