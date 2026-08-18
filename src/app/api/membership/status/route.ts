import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseClient';
import { adminAuth } from '@/lib/firebase-admin';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const email = searchParams.get('email')?.trim().toLowerCase();

        if (!email) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }

        // --- SECURITY: Verify Identity ---
        const authHeader = req.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.warn(`[Status] Unauthorized attempt to check status for: ${email}`);
            return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
        }

        const idToken = authHeader.split('Bearer ')[1];
        let mappedUserId = null;
        try {
            const decodedToken = await adminAuth.verifyIdToken(idToken);
            
            // Map Firebase UID to deterministic UUID
            const { v5: uuidv5 } = await import('uuid');
            const { SM_UUID_NAMESPACE } = await import('@/lib/userProfile');
            mappedUserId = uuidv5(decodedToken.uid, SM_UUID_NAMESPACE);
            
            // --- ROBUST EMAIL DETECTION ---
            let tokenEmail = decodedToken.email?.toLowerCase();
            
            // Fallback 1: Check identities array (Google tokens)
            if (!tokenEmail && (decodedToken as any).firebase?.identities?.email) {
                tokenEmail = (decodedToken as any).firebase.identities.email[0]?.toLowerCase();
            }

            // Fallback 2: Direct Profile Fetch
            if (!tokenEmail) {
                console.log(`[Status] Email claim missing for ${decodedToken.uid}, fetching from Firebase Service Account...`);
                try {
                    const userRecord = await adminAuth.getUser(decodedToken.uid);
                    tokenEmail = userRecord.email?.toLowerCase();
                    console.log(`[Status] Recovered email from Service: ${tokenEmail}`);
                } catch (userErr) {
                    console.error('[Status] Failed to fetch user profile:', userErr);
                }
            }
            
            // Authorization Check: The logged-in user can only check their own status
            if (tokenEmail !== email) {
                console.warn(`[Status] Permission Denied: TokenEmail=${tokenEmail} tried to check QueryEmail=${email}`);
                return NextResponse.json({ 
                    error: 'Permission denied', 
                    details: `Token is for ${tokenEmail}, but checking ${email}` 
                }, { status: 403 });
            }
        } catch (authErr: any) {
            console.error('[Status] Token verification failed:', authErr.message);
            return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
        }
        // ---------------------------------

        const supabase = createAdminClient();

        // Self-heal: paid on Razorpay but still "created" in DB (verify/webhook missed)
        const { data: pendingSub } = await supabase
            .from('user_subscriptions')
            .select('*')
            .or(`customer_email.eq.${email},user_id.eq.${mappedUserId}`)
            .in('status', ['created', 'authenticated'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (pendingSub?.razorpay_order_id || pendingSub?.razorpay_subscription_id) {
            const { activateSubscription } = await import('@/lib/activate-subscription');
            const healResult = await activateSubscription({
                razorpayOrderId: pendingSub.razorpay_order_id || null,
                razorpaySubscriptionId: pendingSub.razorpay_subscription_id || null,
                source: 'status',
            });
            if (healResult.success) {
                console.log(`[Status] Self-healed pending subscription for ${email}`);
            }
        }

        // 1. Check for active subscription for this email OR user_id
        const { data: subscription, error } = await supabase
            .from('user_subscriptions')
            .select('*')
            .or(`customer_email.eq.${email},user_id.eq.${mappedUserId}`)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
             console.error('[Status] Database error:', error);
             return NextResponse.json({ error: 'Internal Database Error' }, { status: 500 });
        }

        if (subscription) {
            // --- IDENTITY MIGRATION: If subscription exists but is linked to a different user_id (split identity) ---
            if (subscription.user_id !== mappedUserId && mappedUserId) {
                try {
                    console.log(`[Status] Identity migration initiated: ${subscription.user_id} -> ${mappedUserId} for ${email}`);
                    
                    const { error: updateError } = await supabase
                        .from('user_subscriptions')
                        .update({ 
                            user_id: mappedUserId,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', subscription.id);
                    
                    if (updateError) throw updateError;
                    
                    subscription.user_id = mappedUserId; // Update local copy
                    console.log(`[Status] Identity migration successful for ${email}`);
                } catch (migrationErr) {
                    console.error('[Status] Identity migration failed:', migrationErr);
                }
            }
            // --- FALLBACK SELF-HEALING: If user_id was null (Legacy) ---
            else if (!subscription.user_id) {
                try {
                    console.log(`[Status] Self-healing initiated for missing user_id: ${email}`);
                    const { findOrCreateUserByContact } = await import('@/lib/userProfile');
                    const userId = await findOrCreateUserByContact({
                        email: subscription.customer_email,
                        phone: subscription.customer_phone,
                        name: subscription.customer_name
                    });

                    if (userId) {
                        await supabase
                            .from('user_subscriptions')
                            .update({ user_id: userId })
                            .eq('id', subscription.id);
                        
                        subscription.user_id = userId; // Update local copy for further processing
                        console.log(`[Status] Self-healing successful for ${email}`);
                    }
                } catch (healingErr) {
                    console.error('[Status] Self-healing failed:', healingErr);
                }
            }

            // --- SYNC: Real-time self-healing with Razorpay ---
            let expiryDate = subscription.current_period_end;
            
            if (subscription.razorpay_subscription_id) {
                try {
                    console.log(`[Status] Syncing subscription ${subscription.razorpay_subscription_id} for ${email} with Razorpay...`);
                    const { getRazorpaySubscription } = await import('@/lib/razorpay');
                    const subDetail = await getRazorpaySubscription(subscription.razorpay_subscription_id);
                    
                    const rzpStatus = subDetail.status;
                    const rzpCancelAtEnd = !!(subDetail as any).cancel_at_cycle_end;
                    const rzpExpiry = subDetail.current_end ? new Date(subDetail.current_end * 1000).toISOString() : null;
                    
                    let needsUpdate = false;
                    const updatePayload: any = {};
                    
                    if (subscription.status !== rzpStatus) {
                        needsUpdate = true;
                        updatePayload.status = rzpStatus;
                        subscription.status = rzpStatus; // Update local copy
                    }
                    
                    if (!!subscription.cancel_at_period_end !== rzpCancelAtEnd) {
                        needsUpdate = true;
                        updatePayload.cancel_at_period_end = rzpCancelAtEnd;
                        subscription.cancel_at_period_end = rzpCancelAtEnd; // Update local copy
                    }
                    
                    if (rzpExpiry && expiryDate !== rzpExpiry) {
                        needsUpdate = true;
                        updatePayload.current_period_end = rzpExpiry;
                        expiryDate = rzpExpiry; // Update local copy
                    }
                    
                    if (needsUpdate) {
                        console.log(`[Status] Self-healing DB mismatch for subscription ${subscription.razorpay_subscription_id}:`, updatePayload);
                        updatePayload.updated_at = new Date().toISOString();
                        await supabase
                            .from('user_subscriptions')
                            .update(updatePayload)
                            .eq('id', subscription.id);
                            
                        // Also update legacy subscriptions table if needed
                        try {
                            await supabase
                                .from('subscriptions')
                                .update({
                                    status: rzpStatus,
                                    updated_at: new Date().toISOString()
                                })
                                .eq('razorpay_subscription_id', subscription.razorpay_subscription_id);
                        } catch (e) {}
                    }
                } catch (syncErr: any) {
                    const errorMsg = syncErr?.description || syncErr?.error?.description || syncErr?.message || JSON.stringify(syncErr);
                    console.error('[Status] Failed to sync from Razorpay:', errorMsg);
                }
            }

            // If the subscription is no longer active after sync, treat as not a member
            if (subscription.status !== 'active') {
                return NextResponse.json({ 
                    success: true, 
                    isMember: false 
                });
            }

            // Check if membership period has elapsed
            if (expiryDate && new Date(expiryDate).getTime() < Date.now()) {
                return NextResponse.json({ 
                    success: true, 
                    isMember: false,
                    isExpired: true,
                    expiry: expiryDate
                });
            }
            // ----------------------------------------------------------------

            return NextResponse.json({ 
                success: true, 
                isMember: true, 
                plan: subscription.razorpay_plan_id,
                is_verified: subscription.is_verified,
                expiry: expiryDate,
                cancel_at_period_end: !!subscription.cancel_at_period_end
            });
        }

        return NextResponse.json({ 
            success: true, 
            isMember: false 
        });

    } catch (error: any) {
        console.error('[Status] Internal Error:', error);
        return NextResponse.json({ 
            success: false, 
            error: error.message || 'Internal Server Error' 
        }, { status: 500 });
    }
}
