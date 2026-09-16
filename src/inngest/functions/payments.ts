import { inngest, BookingVerifiedData, MembershipVerifiedData, CreditsVerifiedData } from '../client';
import { createAdminClient } from '@/lib/supabaseClient';
import { getEventById } from '@/lib/events';
import { sendEmail, generateBookingConfirmationHtml } from '@/lib/email';
import { activateSubscription } from '@/lib/activate-subscription';
import { findOrCreateUserByContact } from '@/lib/userProfile';

/**
 * Handles post-payment asynchronous ticket generation and email delivery for bookings.
 */
export const processBookingPayment = inngest.createFunction(
    { 
        id: 'process-booking-payment', 
        name: 'Process Booking Ticket & Email Delivery',
        retries: 3,
        triggers: [{ event: 'payment/booking.verified' }],
    },
    async ({ event, step }) => {
        const data = event.data as BookingVerifiedData;
        const bookingId = data.bookingId;

        // 1. Fetch booking details
        const booking = await step.run('fetch-booking', async () => {
            const supabase = createAdminClient();
            const { data: b, error } = await supabase
                .from('bookings')
                .select('*, booking_items(*, ticket_tiers(*))')
                .eq('id', bookingId)
                .single();

            if (error || !b) {
                throw new Error(`Booking ${bookingId} not found: ${error?.message}`);
            }
            return b;
        });

        // 2. Fetch event details
        const eventData = await step.run('fetch-event', async () => {
            const ev = await getEventById(booking.event_id);
            if (!ev) {
                throw new Error(`Event ${booking.event_id} not found for booking ${bookingId}`);
            }
            return ev;
        });

        // 3. Generate PDF Ticket
        const pdfBase64 = await step.run('generate-ticket-pdf', async () => {
            const { generateTicketPdf } = await import('@/lib/ticket-generator');
            const pdfBytes = await generateTicketPdf({
                booking_ref: booking.booking_ref,
                attendee_name: booking.attendee_name,
                event_title: eventData.title,
                event_date: new Date(eventData.start_datetime).toLocaleDateString('en-IN', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                    timeZone: 'Asia/Kolkata',
                }),
                venue_name: eventData.location?.venue_name || eventData.location?.city || 'Selected Venue',
                items: (booking.booking_items || []).map((item: any) => ({
                    ticket_tier_name: item.ticket_tiers?.name || 'General Admission',
                    quantity: item.quantity,
                })),
            });
            return Buffer.from(pdfBytes).toString('base64');
        });

        // 4. Send confirmation email with PDF attachment
        await step.run('send-confirmation-email', async () => {
            const html = generateBookingConfirmationHtml({
                ...booking,
                booking_items: (booking.booking_items || []).map((item: any) => ({
                    ...item,
                    ticket_tier_name: item.ticket_tiers?.name || 'Ticket',
                })),
            }, eventData);

            await sendEmail({
                to: booking.attendee_email,
                subject: `Booking Confirmed: ${eventData.title}`,
                html,
                cc: ['team@strangermingle.com'],
                attachments: [
                    {
                        filename: `ticket-${booking.booking_ref}.pdf`,
                        content: Buffer.from(pdfBase64, 'base64'),
                    },
                ],
            });
        });

        return { success: true, bookingId };
    }
);

/**
 * Handles membership activation and verification email in the background.
 */
export const activateMembershipPayment = inngest.createFunction(
    { 
        id: 'activate-membership-payment', 
        name: 'Activate Membership Subscription',
        retries: 3,
        triggers: [{ event: 'payment/membership.verified' }],
    },
    async ({ event, step }) => {
        const data = event.data as MembershipVerifiedData;
        const { razorpayOrderId, razorpaySubscriptionId, razorpayPaymentId, source = 'webhook', forceResendEmail } = data;

        const result = await step.run('activate-subscription-record', async () => {
            return await activateSubscription({
                razorpayOrderId: razorpayOrderId || undefined,
                razorpaySubscriptionId: razorpaySubscriptionId || undefined,
                razorpayPaymentId: razorpayPaymentId || undefined,
                source: source as any,
                forceResendEmail,
            });
        });

        return result;
    }
);

/**
 * Handles awarding Phone-a-Friend credits in the background.
 */
export const awardCreditsPayment = inngest.createFunction(
    { 
        id: 'award-credits-payment', 
        name: 'Award Phone-a-Friend Credits',
        retries: 3,
        triggers: [{ event: 'payment/credits.verified' }],
    },
    async ({ event, step }) => {
        const data = event.data as CreditsVerifiedData;
        const { email, phone, name, creditsToAdd, razorpayOrderId } = data;

        const result = await step.run('credit-user-account', async () => {
            const userId = await findOrCreateUserByContact({ email, phone, name });
            if (!userId) {
                throw new Error(`Failed to find or create user for contact: ${email}`);
            }

            const supabase = createAdminClient();
            const { data: u, error: fetchErr } = await supabase
                .from('users')
                .select('credits')
                .eq('id', userId)
                .maybeSingle();

            if (fetchErr) {
                throw new Error(`Failed to fetch user credits: ${fetchErr.message}`);
            }

            const newCredits = (u?.credits || 0) + creditsToAdd;
            const { error: updateErr } = await supabase
                .from('users')
                .update({ credits: newCredits, updated_at: new Date().toISOString() })
                .eq('id', userId);

            if (updateErr) {
                throw new Error(`Failed to update user credits: ${updateErr.message}`);
            }

            await supabase.from('notifications').insert({
                user_id: userId,
                type: 'credits_awarded',
                title: 'Credits Added!',
                body: `You received ${creditsToAdd} credits for Phone-a-Friend. Your new balance is ${newCredits}.`,
                channel: 'in_app',
            });

            return { success: true, userId, newCredits, razorpayOrderId };
        });

        return result;
    }
);
