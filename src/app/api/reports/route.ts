import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseClient';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      reporterId,
      reportedId,
      reportedType = 'user',
      reason,
      details,
      callId,
      callRef,
      conversationId,
      deviceFingerprint,
    } = body;

    if (!reporterId || !reportedId || !reason) {
      return NextResponse.json(
        { error: 'reporterId, reportedId, and reason are required' },
        { status: 400 }
      );
    }

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      req.headers.get('cf-connecting-ip') ||
      'unknown';

    const userAgent = req.headers.get('user-agent') || 'unknown';

    const supabase = createAdminClient();

    const reportId = uuidv4();
    const evidence = {
      call_id: callId || null,
      call_ref: callRef || null,
      conversation_id: conversationId || null,
      ip_address: ip,
      device_fingerprint: deviceFingerprint || null,
      user_agent: userAgent,
      reported_at: new Date().toISOString(),
    };

    const { data: report, error } = await supabase
      .from('reports')
      .insert({
        id: reportId,
        reporter_id: reporterId,
        reported_type: reportedType,
        reported_id: reportedId,
        reason,
        details: details || '',
        evidence_urls: evidence,
        status: 'pending',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[ReportsApi] Error saving report:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // If attached to a call, note it on the call
    if (callId) {
      try {
        await supabase
          .from('phone_a_friend_calls')
          .update({
            host_notes: `REPORT FILED: ${reason} - ${details || ''}`.slice(0, 500),
            updated_at: new Date().toISOString(),
          })
          .eq('id', callId);
      } catch (e) {
        console.warn('[ReportsApi] Could not annotate call session:', e);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Report submitted successfully. Our safety team will review the session immediately.',
      reportId: report.id,
    });
  } catch (err: any) {
    console.error('[ReportsApi] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
