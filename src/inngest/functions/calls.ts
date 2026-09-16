import { inngest } from '../client';
import { createAdminClient } from '@/lib/supabaseClient';
import { v4 as uuidv4 } from 'uuid';
import { generatePhoneAFriendTicketPdf } from '@/lib/ticket-generator';
import { sendEmail } from '@/lib/email';
import { CallInitiatedData } from '../client';

/**
 * processCallInitiated handles heavy asynchronous tasks after a Phone-a-Friend call is initiated.
 * It is responsible for:
 * 1. Dispatching Web Push notifications to the host.
 * 2. Saving telemetry data.
 * 3. Checking/Creating 1-month free premium memberships.
 * 4. Generating the PDF Call Pass.
 * 5. Sending the confirmation email.
 */
export const processCallInitiated = inngest.createFunction(
    { 
        id: 'process-call-initiated', 
        name: 'Process Call Initiated',
        triggers: [{ event: 'calls/initiated' }],
    },
    async ({ event, step }) => {
        const data = event.data as CallInitiatedData;
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://strangermingle.com';

        // 1. Dispatch Web Push Notification (Fail-safe, don't fail the whole job if this errors)
        await step.run('dispatch-push-notification', async () => {
            try {
                const { sendCallPushNotification } = await import('@/lib/pushService');
                const callerNameForPush = data.callerName || 'A Member';
                await sendCallPushNotification(data.hostId, {
                    callId: data.callId,
                    callRef: data.callRef,
                    callerName: callerNameForPush,
                    amount: data.amount,
                    durationMinutes: data.durationMinutes,
                });
            } catch (err) {
                console.warn('[Inngest] Push notification failed:', err);
                // Return safely to continue processing
                return { success: false, error: String(err) };
            }
            return { success: true };
        });

        // 2. Insert Telemetry
        await step.run('insert-telemetry', async () => {
            const db = createAdminClient();
            try {
                await db.from('phone_a_friend_telemetry').insert({
                    call_id: data.callId,
                    user_id: data.userId,
                    ip_address: null, // PII omitted from background event
                    device_fingerprint: data.deviceFingerprint || 'unknown',
                    user_agent: null,
                    caller_name: data.callerName || null,
                    caller_email: data.callerEmail || null,
                    caller_phone: data.callerPhone || null,
                    client_metadata: {
                        device_call_count: data.deviceCallCount || 1,
                        call_ref: data.callRef,
                        duration_minutes: data.durationMinutes,
                        credits_awarded: data.creditsEarned,
                    },
                });
            } catch (err) {
                console.warn('[Inngest] Telemetry insert failed:', err);
                return { success: false, error: String(err) };
            }
            return { success: true };
        });

        // Skip email & membership logic if no email was provided
        if (!data.callerEmail) {
            return { status: 'completed_without_email' };
        }
        
        const normalizedEmail = data.callerEmail.trim().toLowerCase();

        // 3. Process Membership
        const membershipResult = await step.run('check-and-provision-membership', async () => {
            const db = createAdminClient();
            let isExistingMember = false;
            let verificationToken = null;

            try {
                const { data: existingSub } = await db
                    .from('user_subscriptions')
                    .select('id, status, is_verified')
                    .or(`user_id.eq.${data.userId},customer_email.eq.${normalizedEmail}`)
                    .eq('status', 'active')
                    .limit(1)
                    .maybeSingle();

                if (existingSub) {
                    isExistingMember = true;
                } else {
                    verificationToken = uuidv4();
                    const now = new Date();
                    const currentStart = now.toISOString();
                    const currentEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

                    await db.from('user_subscriptions').insert({
                        user_id: data.userId,
                        customer_name: data.callerName || 'Community Friend',
                        customer_email: normalizedEmail,
                        customer_phone: data.callerPhone || null,
                        status: 'active',
                        is_verified: false,
                        verification_token: verificationToken,
                        plan_type: 'monthly',
                        current_period_start: currentStart,
                        current_period_end: currentEnd,
                        notes: {
                            free_trial: true,
                            source: 'phone_a_friend',
                            call_ref: data.callRef,
                            credits_awarded: data.creditsEarned,
                        },
                    });
                }
            } catch (err) {
                console.warn('[Inngest] Membership processing failed:', err);
                // Continue to email generation even if this fails
            }
            
            return { isExistingMember, verificationToken };
        });

        // 4 & 5. Generate PDF and Send Email
        await step.run('generate-pdf-and-send-email', async () => {
            const db = createAdminClient();
            
            // Fetch host details for the email
            const { data: host } = await db.from('host_profiles').select('display_name').eq('id', data.hostId).single();
            const hostName = host?.display_name || 'Community Host';
            
            // Generate PDF
            const pdfBytes = await generatePhoneAFriendTicketPdf({
                callRef: data.callRef,
                callerName: data.callerName || 'Valued Caller',
                callerEmail: data.callerEmail,
                callerPhone: data.callerPhone,
                hostName: hostName,
                callType: 'instant', // Best effort
                durationMinutes: data.durationMinutes,
                amountPaid: data.amount,
                scheduledTime: undefined,
                createdAt: new Date().toISOString(),
            });

            // Prepare Email Content
            const dashboardLink = `${appUrl}/members`;
            const verificationLink = membershipResult.verificationToken 
                ? `${appUrl}/verify-membership?token=${membershipResult.verificationToken}` 
                : dashboardLink;

            const isPaidWithCredits = data.paymentMethod === 'credits';

            const emailSubject = isPaidWithCredits
                ? `Call Pass Confirmed: [${data.callRef}] (${data.creditsNeeded} Credits Redeemed)`
                : membershipResult.isExistingMember
                ? `Payment Confirmed: Your Call Pass [${data.callRef}] & ${data.creditsEarned} Credits Added`
                : `Payment Confirmed [${data.callRef}] + Activate Your 1-Month Free Membership (${data.creditsEarned} Credits)`;

            const ctaButtonHtml = (membershipResult.isExistingMember || isPaidWithCredits)
                ? `
                  <div style="text-align: center; margin: 28px 0;">
                    <a href="${dashboardLink}" style="background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: bold; font-size: 15px; display: inline-block; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);">
                      Open Member Dashboard →
                    </a>
                    <p style="font-size: 12px; color: #6b7280; margin-top: 8px;">View your active membership status and credit balance.</p>
                  </div>
                `
                : `
                  <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 16px; padding: 20px; margin: 24px 0; text-align: center;">
                    <div style="font-size: 16px; font-weight: 700; color: #166534; margin-bottom: 6px;">🎁 Bonus: 1-Month Free Premium Membership!</div>
                    <p style="font-size: 13px; color: #15803d; margin: 0 0 16px 0;">
                      Because you called a friend, you have unlocked 1 month of complimentary access to Stranger Mingle along with <strong>${data.creditsEarned} credits</strong>.
                    </p>
                    <a href="${verificationLink}" style="background: linear-gradient(135deg, #16a34a, #15803d); color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: bold; font-size: 15px; display: inline-block; box-shadow: 0 4px 12px rgba(22, 163, 74, 0.25);">
                      Verify Email & Activate Free Month →
                    </a>
                  </div>
                `;

            await sendEmail({
                to: normalizedEmail,
                subject: emailSubject,
                html: `
                  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; color: #1f2937; max-width: 600px; margin: auto; border: 1px solid #f3f4f6; border-radius: 16px; background-color: #ffffff;">
                    <div style="border-bottom: 2px solid #f43f5e; padding-bottom: 12px; margin-bottom: 20px;">
                      <h1 style="color: #f43f5e; margin: 0; font-size: 22px;">Stranger Mingle</h1>
                      <p style="margin: 4px 0 0 0; color: #6b7280; font-size: 13px;">Phone a Friend - 1-on-1 Confidential Voice Call</p>
                    </div>
                    <p style="font-size: 15px; line-height: 1.5;">Hello <strong>${data.callerName || 'Friend'}</strong>,</p>
                    <p style="font-size: 14px; line-height: 1.5; color: #4b5563;">
                      ${
                        isPaidWithCredits
                          ? `Your call pass has been confirmed using <strong>${data.creditsNeeded} Membership Credits</strong>.`
                          : `Your payment of <strong>INR ${data.amount}/-</strong> has been confirmed. We have credited <strong>🪙 ${data.creditsEarned} Credits</strong> (1 INR = 10 Credits) to your account.`
                      }
                    </p>
        
                    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; background: #f9fafb; border-radius: 12px; overflow: hidden;">
                      <tr><td style="padding: 10px 14px; color: #6b7280; border-bottom: 1px solid #e5e7eb;">Call Reference:</td><td style="padding: 10px 14px; font-weight: bold; color: #f43f5e; border-bottom: 1px solid #e5e7eb;">${data.callRef}</td></tr>
                      <tr><td style="padding: 10px 14px; color: #6b7280; border-bottom: 1px solid #e5e7eb;">Assigned Host:</td><td style="padding: 10px 14px; font-weight: bold; border-bottom: 1px solid #e5e7eb;">${hostName}</td></tr>
                      <tr><td style="padding: 10px 14px; color: #6b7280; border-bottom: 1px solid #e5e7eb;">Session Duration:</td><td style="padding: 10px 14px; font-weight: bold; border-bottom: 1px solid #e5e7eb;">${data.durationMinutes} Minutes</td></tr>
                      ${
                        isPaidWithCredits
                          ? `<tr><td style="padding: 10px 14px; color: #6b7280; border-bottom: 1px solid #e5e7eb;">Credits Redeemed:</td><td style="padding: 10px 14px; font-weight: bold; color: #f43f5e; border-bottom: 1px solid #e5e7eb;">-${data.creditsNeeded} Credits</td></tr>
                             <tr><td style="padding: 10px 14px; color: #6b7280;">Payment Method:</td><td style="padding: 10px 14px; font-weight: bold;">Membership Credits</td></tr>`
                          : `<tr><td style="padding: 10px 14px; color: #6b7280; border-bottom: 1px solid #e5e7eb;">Credits Added:</td><td style="padding: 10px 14px; font-weight: bold; color: #059669; border-bottom: 1px solid #e5e7eb;">+${data.creditsEarned} Credits</td></tr>
                             <tr><td style="padding: 10px 14px; color: #6b7280;">Amount Paid:</td><td style="padding: 10px 14px; font-weight: bold;">INR ${data.amount}/-</td></tr>`
                      }
                    </table>
        
                    ${ctaButtonHtml}
        
                    <p style="font-size: 13px; color: #6b7280;">📎 Your official <strong>PDF Call Pass</strong> is attached to this email for your records.</p>
                    <div style="background-color: #fff1f2; border-left: 4px solid #f43f5e; padding: 12px; border-radius: 8px; margin-top: 20px; font-size: 12px; color: #9f1239;">
                      <strong>Safety Reminder:</strong> 100% Anonymous voice calls. Exchanging personal phone numbers, WhatsApp, or financial details is strictly prohibited.
                    </div>
                  </div>
                `,
                attachments: [
                  {
                    filename: `ticket-${data.callRef}.pdf`,
                    content: Buffer.from(pdfBytes),
                  },
                ],
            });
            
            return { success: true };
        });

        return { status: 'completed' };
    }
);
