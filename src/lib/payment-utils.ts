import { createAdminClient } from './supabaseClient';
import { getEventById } from './events';
import { sendEmail, generateBookingConfirmationHtml } from './email';

export type PaymentProcessingResult = {
    success: boolean;
    error?: string;
    isAlreadyProcessed?: boolean;
    bookingId?: string;
};

export async function processPaymentSuccess({
    razorpayOrderId,
    bookingId,
    razorpayPaymentId,
    razorpaySignature,
    razorpayMethod = 'online',
}: {
    razorpayOrderId?: string;
    bookingId?: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
    razorpayMethod?: string;
}): Promise<PaymentProcessingResult> {
    const supabase = createAdminClient();

    try {
        // 1. Find the booking record
        let query = supabase
            .from('bookings')
            .select('*, booking_items(*, ticket_tiers(*))');
        
        if (bookingId) {
            query = query.eq('id', bookingId);
        } else if (razorpayOrderId) {
            query = query.eq('razorpay_order_id', razorpayOrderId);
        } else {
            return { success: false, error: 'Neither bookingId nor razorpayOrderId provided' };
        }

        const { data: booking, error: fetchError } = await query.single();

        if (fetchError || !booking) {
            console.error('Booking not found for identifiers:', { bookingId, razorpayOrderId });
            return {
                success: false,
                error: 'Booking not found'
            };
        }

        // 2. Check if already processed
        if (booking.status === 'confirmed' || booking.payment_status === 'paid') {
            return {
                success: true,
                isAlreadyProcessed: true,
                bookingId: booking.id
            };
        }

        // 3. Call the atomic confirmation RPC
        const { data: _tickets, error: rpcError } = await supabase.rpc(
            'confirm_booking_payment_v2',
            {
                p_booking_id: booking.id,
                p_razorpay_payment_id: razorpayPaymentId,
                p_razorpay_signature: razorpaySignature,
                p_razorpay_method: razorpayMethod,
            }
        );

        if (rpcError) {
            console.error('Error in confirm_booking_payment_v2:', rpcError);
            return {
                success: false,
                error: rpcError.message || 'Failed to confirm booking'
            };
        }

        // 4. Send Confirmation Email with PDF Ticket
        try {
            const { generateTicketPdf } = await import('./ticket-generator');
            const event = await getEventById(booking.event_id);
            if (event) {
                const _firstItem = booking.booking_items?.[0];
                const pdfBytes = await generateTicketPdf({
                    booking_ref: booking.booking_ref,
                    attendee_name: booking.attendee_name,
                    event_title: event.title,
                    event_date: new Date(event.start_datetime).toLocaleDateString('en-IN', { 
                        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                        hour: '2-digit', minute: '2-digit', hour12: true,
                        timeZone: 'Asia/Kolkata'
                    }),
                    venue_name: event.location?.venue_name || event.location?.city || 'Selected Venue',
                    items: booking.booking_items.map((item: { ticket_tiers: { name: string } | null; quantity: number }) => ({
                        ticket_tier_name: item.ticket_tiers?.name || 'General Admission',
                        quantity: item.quantity,
                    })),
                });

                const html = generateBookingConfirmationHtml({
                    ...booking,
                    booking_items: booking.booking_items?.map((item: { ticket_tiers: { name: string } | null }) => ({
                        ...item,
                        ticket_tier_name: item.ticket_tiers?.name || 'Ticket'
                    }))
                }, event);

                await sendEmail({
                    to: booking.attendee_email,
                    subject: `Booking Confirmed: ${event.title}`,
                    html,
                    cc: ['team@strangermingle.com'],
                    attachments: [
                        {
                            filename: `ticket-${booking.booking_ref}.pdf`,
                            content: Buffer.from(pdfBytes),
                        }
                    ]
                });
            }
        } catch (emailError) {
            console.error('Non-critical: Failed to send confirmation email:', emailError);
            // Don't fail the whole process if email fails
        }

        return {
            success: true,
            bookingId: booking.id
        };

    } catch (error: unknown) {
        console.error('Error processing payment success:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Internal processing error'
        };
    }
}
