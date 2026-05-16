import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseClient';
import { adminAuth } from '@/lib/firebase-admin';
import { razorpay } from '@/lib/razorpay';
import { v5 as uuidv5 } from 'uuid';
import { SM_UUID_NAMESPACE } from '@/lib/userProfile';

export async function POST(req: NextRequest) {
    try {
        const { reason } = await req.json();

        // --- SECURITY: Verify Identity ---
        const authHeader = req.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
        }

        const idToken = authHeader.split('Bearer ')[1];
        let mappedUserId = null;
        let tokenEmail = null;

        try {
            const decodedToken = await adminAuth.verifyIdToken(idToken);
            mappedUserId = uuidv5(decodedToken.uid, SM_UUID_NAMESPACE);
            tokenEmail = decodedToken.email?.toLowerCase();

            if (!tokenEmail && (decodedToken as any).firebase?.identities?.email) {
                tokenEmail = (decodedToken as any).firebase.identities.email[0]?.toLowerCase();
            }

            if (!tokenEmail) {
                const userRecord = await adminAuth.getUser(decodedToken.uid);
                tokenEmail = userRecord.email?.toLowerCase();
            }
        } catch (authErr: any) {
            console.error('[SubscriptionCancel] Token verification failed:', authErr.message);
            return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
        }

        if (!mappedUserId || !tokenEmail) {
            return NextResponse.json({ error: 'User identity could not be verified' }, { status: 400 });
        }

        const supabase = createAdminClient();

        // 1. Find active subscription for this user
        const { data: subscription, error: subError } = await supabase
            .from('user_subscriptions')
            .select('*')
            .eq('user_id', mappedUserId)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (subError) {
            console.error('[SubscriptionCancel] Database error:', subError);
            return NextResponse.json({ error: 'Internal Database Error' }, { status: 500 });
        }

        if (!subscription || !subscription.razorpay_subscription_id) {
            return NextResponse.json({ error: 'No active subscription found' }, { status: 404 });
        }

        // 2. Call Razorpay to cancel at end of cycle
        try {
            console.log(`[SubscriptionCancel] Cancelling Razorpay sub: ${subscription.razorpay_subscription_id} for user: ${mappedUserId}`);
            
            await razorpay.subscriptions.cancel(subscription.razorpay_subscription_id, true);

            // 3. Update database
            const { error: updateError } = await supabase
                .from('user_subscriptions')
                .update({ 
                    cancel_at_period_end: true,
                    cancel_reason: reason || 'User requested cancellation',
                    updated_at: new Date().toISOString()
                })
                .eq('id', subscription.id);

            if (updateError) {
                console.error('[SubscriptionCancel] Failed to update DB after Razorpay cancellation:', updateError);
                // We don't return error here because Razorpay already cancelled it. 
                // Webhook will hopefully catch up, but we should inform the user.
            }

            return NextResponse.json({ 
                success: true, 
                message: 'Your subscription will be cancelled at the end of the current billing period.' 
            });

        } catch (rzpError: any) {
            console.error('[SubscriptionCancel] Razorpay Error:', rzpError);
            return NextResponse.json({ 
                error: 'Failed to cancel subscription with payment provider', 
                details: rzpError.description || rzpError.message 
            }, { status: 500 });
        }

    } catch (error: any) {
        console.error('[SubscriptionCancel] Internal Error:', error);
        return NextResponse.json({ 
            error: error.message || 'Internal Server Error' 
        }, { status: 500 });
    }
}
