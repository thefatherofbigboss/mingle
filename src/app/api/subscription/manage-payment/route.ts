import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseClient';
import { adminAuth } from '@/lib/firebase-admin';
import { razorpay } from '@/lib/razorpay';
import { v5 as uuidv5 } from 'uuid';
import { SM_UUID_NAMESPACE } from '@/lib/userProfile';

export async function POST(req: NextRequest) {
    try {
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
            console.error('[ManagePayment] Token verification failed:', authErr.message);
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
            console.error('[ManagePayment] Database error:', subError);
            return NextResponse.json({ error: 'Internal Database Error' }, { status: 500 });
        }

        if (!subscription || !subscription.razorpay_subscription_id) {
            return NextResponse.json({ error: 'No active subscription found' }, { status: 404 });
        }

        // 2. Create a Subscription Link for the user to manage their payment
        // This generates a secure Razorpay-hosted URL
        try {
            console.log(`[ManagePayment] Creating subscription link for: ${subscription.razorpay_subscription_id}`);
            
            // Note: As of razorpay-node v2.9.x, subscription_links may not be fully mapped in the SDK.
            // We'll use a direct API call with the same credentials.
            const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
            
            const response = await fetch('https://api.razorpay.com/v1/subscription_links', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${auth}`
                },
                body: JSON.stringify({
                    subscription_id: subscription.razorpay_subscription_id,
                    notify: {
                        email: true,
                        sms: false
                    },
                    callback_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://strangermingle.com'}/members/profile`,
                    callback_method: 'get'
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error?.description || 'Failed to create subscription link');
            }

            const linkResponse = await response.json();

            return NextResponse.json({ 
                success: true, 
                short_url: linkResponse.short_url 
            });

        } catch (rzpError: any) {
            console.error('[ManagePayment] Razorpay Error:', rzpError);
            
            // Fallback: If subscriptionLinks is not available or fails, 
            // we could potentially suggest the user to use the Razorpay portal directly 
            // or return a specific error.
            return NextResponse.json({ 
                error: 'Failed to generate secure management link', 
                details: rzpError.description || rzpError.message 
            }, { status: 500 });
        }

    } catch (error: any) {
        console.error('[ManagePayment] Internal Error:', error);
        return NextResponse.json({ 
            error: error.message || 'Internal Server Error' 
        }, { status: 500 });
    }
}
