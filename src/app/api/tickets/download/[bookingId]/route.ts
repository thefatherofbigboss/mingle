import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseClient';
import { generateTicketPdf } from '@/lib/ticket-generator';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ bookingId: string }> }
) {
    try {
        const { bookingId } = await context.params;
        
        const supabase = createAdminClient();
        console.log(`Fetching booking details for ID: ${bookingId}`);
        
        const { data: booking, error: bError } = await supabase
            .from('bookings')
            .select('*, booking_items(*, ticket_tiers(*)), events(*, location:locations(*))')
            .eq('id', bookingId)
            .single();
            
        if (bError || !booking) {
            console.error('Booking fetch error:', bError);
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
        }
        
        console.log('Booking found:', { 
            id: booking.id, 
            status: booking.status, 
            payment_status: booking.payment_status,
            has_event: !!booking.events,
            items_count: booking.booking_items?.length 
        });

        // Ensure only the attendee or admin can download (simplification for now: check if confirmed)
        if (booking.status !== 'confirmed' && booking.payment_status !== 'paid') {
            console.warn(`Booking ${bookingId} not confirmed. Status: ${booking.status}, Payment: ${booking.payment_status}`);
            return NextResponse.json({ error: 'Booking not confirmed' }, { status: 403 });
        }
        
        const event = booking.events;
        if (!event) {
            console.error('Event details missing for booking:', bookingId);
            return NextResponse.json({ error: 'Event details not found' }, { status: 404 });
        }
        
        if (!booking.booking_items || booking.booking_items.length === 0) {
            console.error('No ticket items found for booking:', bookingId);
            return NextResponse.json({ error: 'No tickets found in booking' }, { status: 400 });
        }

        console.log('Generating PDF for event:', event.title);
        
        const pdfBytes = await generateTicketPdf({
            booking_ref: booking.booking_ref,
            attendee_name: booking.attendee_name,
            event_title: event.title || 'Event Ticket',
            event_date: event.start_datetime ? new Date(event.start_datetime).toLocaleDateString('en-IN', { 
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: true,
                timeZone: 'Asia/Kolkata'
            }) : 'Date TBD',
            venue_name: event.location?.venue_name || event.location?.city || 'Selected Venue',
            items: booking.booking_items.map((item: { ticket_tiers: { name: string } | null; quantity: number }) => ({
                ticket_tier_name: item.ticket_tiers?.name || 'General Admission',
                quantity: item.quantity,
            })),
        });
        
        console.log('PDF generated successfully, size:', pdfBytes.length);

        return new NextResponse(Buffer.from(pdfBytes), {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="ticket-${booking.booking_ref}.pdf"`,
            },
        });
    } catch (error: unknown) {
        console.error('CRITICAL: Error in ticket download API:', error);
        return NextResponse.json({ 
            error: 'Failed to generate ticket',
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}
