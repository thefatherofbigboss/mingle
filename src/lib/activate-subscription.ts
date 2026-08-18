import { v4 as uuidv4 } from 'uuid';
import { createAdminClient } from './supabaseClient';
import { getRazorpaySubscription } from './razorpay';
import { findOrCreateUserByContact } from './userProfile';
import { sendEmail, generateMembershipVerificationHtml } from './email';

export type ActivateSubscriptionSource = 'verify' | 'webhook' | 'sync' | 'status';

export interface ActivateSubscriptionParams {
    razorpayOrderId?: string | null;
    razorpaySubscriptionId?: string | null;
    razorpayPaymentId?: string | null;
    source: ActivateSubscriptionSource;
    /** Re-send verification email even if a token already exists */
    forceResendEmail?: boolean;
}

export interface ActivateSubscriptionResult {
    success: boolean;
    error?: string;
    subscriptionId?: string;
    userId?: string | null;
    emailSent?: boolean;
    alreadyActive?: boolean;
}

function normalizeEmail(email?: string | null): string | null {
    return email?.trim().toLowerCase() || null;
}

/**
 * Single source of truth for turning a paid Razorpay order/subscription into an active membership.
 * Used by payment verify, webhooks, status self-healing, and sync jobs.
 */
export async function activateSubscription(
    params: ActivateSubscriptionParams
): Promise<ActivateSubscriptionResult> {
    const { razorpayOrderId, razorpaySubscriptionId, razorpayPaymentId, source, forceResendEmail } = params;
    const supabase = createAdminClient();

    let row: any = null;

    // 1. Look up by razorpayOrderId first, then fallback to razorpaySubscriptionId
    if (razorpayOrderId) {
        const { data } = await supabase
            .from('user_subscriptions')
            .select('*')
            .eq('razorpay_order_id', razorpayOrderId)
            .maybeSingle();
        row = data;
    }

    if (!row && razorpaySubscriptionId) {
        const { data } = await supabase
            .from('user_subscriptions')
            .select('*')
            .eq('razorpay_subscription_id', razorpaySubscriptionId)
            .maybeSingle();
        row = data;
    }

    let rzpSub: Awaited<ReturnType<typeof getRazorpaySubscription>> | null = null;

    // Fetch Razorpay subscription details only if razorpaySubscriptionId exists
    if (razorpaySubscriptionId) {
        try {
            rzpSub = await getRazorpaySubscription(razorpaySubscriptionId);
        } catch (rzpErr) {
            console.error(`[Activate:${source}] Razorpay fetch failed for ${razorpaySubscriptionId}:`, rzpErr);
            if (!row) {
                return { success: false, error: 'Subscription not found in database or Razorpay' };
            }
        }
    }

    // Fallback recovery for legacy subscription mandate if row is missing
    if (!row && rzpSub && razorpaySubscriptionId) {
        const notes = (rzpSub.notes || {}) as Record<string, string>;
        const email = normalizeEmail(notes.email);
        const { error: insertError } = await supabase.from('user_subscriptions').insert({
            razorpay_subscription_id: razorpaySubscriptionId,
            razorpay_customer_id: typeof rzpSub.customer_id === 'string' ? rzpSub.customer_id : null,
            razorpay_plan_id: rzpSub.plan_id,
            customer_name: notes.name || null,
            customer_email: email,
            customer_phone: notes.phone || null,
            status: 'created',
            notes: { plan_type: notes.plan_type, recovered_from: source },
        });

        if (insertError) {
            console.error(`[Activate:${source}] Failed to recover missing DB row:`, insertError);
            return { success: false, error: insertError.message };
        }

        row = await supabase
            .from('user_subscriptions')
            .select('*')
            .eq('razorpay_subscription_id', razorpaySubscriptionId)
            .maybeSingle()
            .then(({ data }) => data);
    }

    if (!row) {
        return { success: false, error: 'Subscription record not found' };
    }

    // If already active and verified
    if (row.status === 'active' && row.user_id && row.verification_token) {
        if (!forceResendEmail) {
            return {
                success: true,
                alreadyActive: true,
                subscriptionId: row.id,
                userId: row.user_id,
            };
        }
    }

    const email = normalizeEmail(row.customer_email);
    let userId = row.user_id;

    if (!userId && email) {
        try {
            userId = await findOrCreateUserByContact({
                email,
                phone: row.customer_phone || undefined,
                name: row.customer_name || undefined,
            });
        } catch (provisionErr) {
            console.error(`[Activate:${source}] User provisioning failed:`, provisionErr);
        }
    }

    let verificationToken = row.verification_token;
    let shouldSendEmail = false;

    if (!row.is_verified) {
        if (!verificationToken) {
            verificationToken = uuidv4();
            shouldSendEmail = true;
        } else if (forceResendEmail) {
            shouldSendEmail = true;
        }
    }

    // Determine validity period
    const now = new Date();
    const isMonthly = row.plan_type === 'monthly' || row.notes?.plan_type === 'monthly';
    const validityDays = isMonthly ? 30 : 365;

    let currentStart = now.toISOString();
    let currentEnd = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000).toISOString();

    // If legacy subscription had timestamps from Razorpay
    if (rzpSub?.current_start && rzpSub?.current_end) {
        currentStart = new Date(rzpSub.current_start * 1000).toISOString();
        currentEnd = new Date(rzpSub.current_end * 1000).toISOString();
    } else if (row.current_period_start && row.current_period_end && source === 'sync') {
        currentStart = row.current_period_start;
        currentEnd = row.current_period_end;
    }

    const updatePayload: Record<string, unknown> = {
        status: 'active',
        user_id: userId,
        customer_email: email || row.customer_email,
        verification_token: verificationToken,
        current_period_start: currentStart,
        current_period_end: currentEnd,
        updated_at: new Date().toISOString(),
    };

    if (razorpayPaymentId) {
        updatePayload.razorpay_payment_id = razorpayPaymentId;
    }

    const { data: updated, error: updateError } = await supabase
        .from('user_subscriptions')
        .update(updatePayload)
        .eq('id', row.id)
        .select()
        .single();

    if (updateError || !updated) {
        console.error(`[Activate:${source}] DB update failed:`, updateError);
        return { success: false, error: updateError?.message || 'Failed to update subscription' };
    }

    // Keep legacy subscriptions table updated if referenced
    if (row.razorpay_subscription_id) {
        try {
            await supabase
                .from('subscriptions')
                .update({ status: 'active', updated_at: new Date().toISOString() })
                .eq('razorpay_subscription_id', row.razorpay_subscription_id);
        } catch (e) {}
    }

    // Record Discount Code usage if applied
    if (updated.discount_code_id) {
        try {
            const { data: existingUsage } = await supabase
                .from('subscription_discount_code_uses')
                .select('id')
                .eq('user_subscription_id', updated.id)
                .eq('discount_code_id', updated.discount_code_id)
                .maybeSingle();

            if (!existingUsage) {
                const originalAmt = Number(updated.original_amount) || (isMonthly ? 499 : 1999);
                const discountAmt = Number(updated.discount_amount) || 0;
                const finalAmt = Math.max(0, originalAmt - discountAmt);

                await supabase.from('subscription_discount_code_uses').insert({
                    discount_code_id: updated.discount_code_id,
                    user_id: updated.user_id || userId || null,
                    user_subscription_id: updated.id,
                    razorpay_order_id: updated.razorpay_order_id || null,
                    razorpay_subscription_id: updated.razorpay_subscription_id || updated.razorpay_order_id || 'ORDER',
                    discount_amount: discountAmt,
                    original_amount: originalAmt,
                    final_amount: finalAmt,
                });

                const { data: codeData } = await supabase
                    .from('subscription_discount_codes')
                    .select('used_count')
                    .eq('id', updated.discount_code_id)
                    .single();

                if (codeData) {
                    await supabase
                        .from('subscription_discount_codes')
                        .update({
                            used_count: (codeData.used_count || 0) + 1,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', updated.discount_code_id);
                }
            }
        } catch (promoLogErr) {
            console.error(`[Activate:${source}] Failed to log discount code usage:`, promoLogErr);
        }
    }

    let emailSent = false;
    const recipientEmail = normalizeEmail(updated.customer_email);

    if (shouldSendEmail && recipientEmail && verificationToken) {
        try {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.strangermingle.com';
            const verificationLink = `${appUrl}/verify-membership?token=${verificationToken}`;

            await sendEmail({
                to: recipientEmail,
                subject: 'Verify Your Stranger Mingle Membership',
                html: generateMembershipVerificationHtml(
                    updated.customer_name || 'Premium Member',
                    verificationLink
                ),
                from: 'Stranger Mingle <team@strangermingle.com>',
            });
            emailSent = true;
            console.log(`[Activate:${source}] Verification email sent to ${recipientEmail}`);
        } catch (emailErr) {
            console.error(`[Activate:${source}] Failed to send verification email:`, emailErr);
        }
    }

    return {
        success: true,
        subscriptionId: updated.id,
        userId: updated.user_id,
        emailSent,
    };
}
