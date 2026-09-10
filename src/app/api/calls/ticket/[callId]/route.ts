import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseClient';
import { generatePhoneAFriendTicketPdf } from '@/lib/ticket-generator';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  try {
    const { callId } = await params;
    if (!callId) {
      return NextResponse.json({ error: 'callId is required' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data: call, error } = await supabase
      .from('phone_a_friend_calls')
      .select(`
        *,
        host:host_profiles!host_id(id, display_name),
        user:users!user_id(id, username, anonymous_alias, email, phone)
      `)
      .eq('id', callId)
      .maybeSingle();

    if (error || !call) {
      return NextResponse.json({ error: 'Call session not found' }, { status: 404 });
    }

    const callerName = call.user?.username || call.user?.anonymous_alias || 'Valued Caller';
    const hostName = call.host?.display_name || 'Community Host';

    const pdfBytes = await generatePhoneAFriendTicketPdf({
      callRef: call.call_ref,
      callerName,
      callerEmail: call.user?.email,
      callerPhone: call.user?.phone,
      hostName,
      callType: call.call_type as any,
      durationMinutes: call.duration_minutes || 15,
      amountPaid: Number(call.amount) || 49,
      scheduledTime: call.scheduled_start_time,
      createdAt: call.created_at,
    });

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="ticket-${call.call_ref}.pdf"`,
      },
    });
  } catch (err: any) {
    console.error('[TicketApi] Failed to generate PDF ticket:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
