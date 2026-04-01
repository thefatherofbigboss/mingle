import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseClient';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await context.params;
        if (!id) {
            return NextResponse.json({ error: 'Missing booking ID' }, { status: 400 });
        }

        const supabase = createAdminClient();
        const { data: booking, error: bError } = await supabase
            .from('bookings')
            .select('*, booking_items(*, ticket_tiers(*)), events(*, location:locations(*))')
            .eq('id', id)
            .single();

        if (bError || !booking) {
            console.error('Error fetching booking details:', bError);
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
        }

        return NextResponse.json(booking);

    } catch (error: unknown) {
        console.error('Error in booking details API:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 });
    }
}
