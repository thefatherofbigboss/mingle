import { NextRequest, NextResponse } from 'next/server';
import {
  getOnlineMembers,
  toggleMemberAvailability,
  sendMemberCallHeartbeat,
  initiateMemberCall,
  respondToMemberCall,
  cancelMemberCall,
  endMemberCall,
  submitMemberCallRating,
  getActiveIncomingCallForMember,
} from '@/lib/memberCallsService';

function corsHeaders(req: NextRequest) {
  const origin = req.headers.get('origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-internal-api-secret',
    'Access-Control-Allow-Credentials': 'true',
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders(req),
  });
}

/**
 * GET /api/members/calls
 * - ?currentUserId=xyz -> List available online members
 * - ?memberId=xyz&activeOnly=true -> Check for incoming ringing call
 */
export async function GET(req: NextRequest) {
  const headers = corsHeaders(req);
  try {
    const { searchParams } = new URL(req.url);
    const currentUserId = searchParams.get('currentUserId');
    const memberId = searchParams.get('memberId');
    const activeOnly = searchParams.get('activeOnly');

    if (memberId && activeOnly === 'true') {
      const activeCall = await getActiveIncomingCallForMember(memberId);
      return NextResponse.json({ call: activeCall }, { headers });
    }

    const onlineMembers = await getOnlineMembers(currentUserId || null);
    return NextResponse.json({ members: onlineMembers }, { headers });
  } catch (error: any) {
    console.error('[API/members/calls GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500, headers });
  }
}

/**
 * POST /api/members/calls
 * Handles actions: 'toggle-availability', 'heartbeat', 'initiate', 'respond', 'cancel', 'end', 'rate'
 */
export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);
  try {
    const body = await req.json();
    const { action, ...payload } = body;

    if (action === 'toggle-availability') {
      const { userId, isAvailable } = payload;
      if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400, headers });
      const result = await toggleMemberAvailability(userId, Boolean(isAvailable));
      return NextResponse.json(result, { headers });
    }

    if (action === 'heartbeat') {
      const { userId } = payload;
      if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400, headers });
      const result = await sendMemberCallHeartbeat(userId);
      return NextResponse.json(result, { headers });
    }

    if (action === 'initiate') {
      const result = await initiateMemberCall(payload);
      return NextResponse.json(result, { headers });
    }

    if (action === 'respond') {
      const result = await respondToMemberCall({
        callId: payload.callId,
        responderId: payload.responderId,
        action: payload.responseAction || payload.actionType || payload.action,
      });
      return NextResponse.json(result, { headers });
    }

    if (action === 'cancel') {
      const result = await cancelMemberCall(payload);
      return NextResponse.json(result, { headers });
    }

    if (action === 'end') {
      const result = await endMemberCall(payload);
      return NextResponse.json(result, { headers });
    }

    if (action === 'rate') {
      const result = await submitMemberCallRating(payload);
      return NextResponse.json(result, { headers });
    }

    return NextResponse.json({ error: 'Invalid action provided' }, { status: 400, headers });
  } catch (error: any) {
    console.error('[API/members/calls POST]', error);
    return NextResponse.json({ error: error.message }, { status: 500, headers });
  }
}
