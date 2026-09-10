import { NextRequest, NextResponse } from 'next/server';
import { 
  getApprovedCallingHosts, 
  getHostCallingDetails, 
  createCallPaymentOrder,
  initiateCall, 
  respondToCall, 
  endCallSession, 
  cancelCallSession,
  getActiveIncomingCallForHost,
  submitCallRating,
  submitHostCallerReview,
  getCallerReputationForHost
} from '@/lib/phoneAFriendService';

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
 * GET /api/calls: List approved calling hosts, specific host details, or caller reputation for hosts.
 */
export async function GET(req: NextRequest) {
  const headers = corsHeaders(req);
  try {
    const { searchParams } = new URL(req.url);
    const hostId = searchParams.get('hostId');
    const callerUserId = searchParams.get('callerUserId');
    const forHost = searchParams.get('forHost');

    if (callerUserId && (forHost === 'true' || hostId)) {
      const reputation = await getCallerReputationForHost(callerUserId);
      return NextResponse.json(reputation, { headers });
    }

    if (hostId && searchParams.get('activeOnly') === 'true') {
      const activeCall = await getActiveIncomingCallForHost(hostId);
      return NextResponse.json({ call: activeCall }, { headers });
    }

    if (hostId) {
      const details = await getHostCallingDetails(hostId);
      return NextResponse.json(details, { headers });
    }

    const hosts = await getApprovedCallingHosts();
    return NextResponse.json(hosts, { headers });
  } catch (error: any) {
    console.error('[API/calls GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500, headers });
  }
}

/**
 * POST /api/calls: Initiate call, respond to call, end call, or rate call.
 */
export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);
  try {
    const body = await req.json();
    const { action, ...payload } = body;
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      req.headers.get('cf-connecting-ip') ||
      'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';
    const enrichedPayload = { ...payload, ip, userAgent };

    if (action === 'create-order' || action === 'create-payment-order') {
      const result = await createCallPaymentOrder(enrichedPayload);
      return NextResponse.json(result, { headers });
    }

    if (action === 'initiate') {
      const result = await initiateCall(enrichedPayload);
      return NextResponse.json(result, { headers });
    }

    if (action === 'respond') {
      const result = await respondToCall({
        ...payload,
        action: payload.action || payload.actionType || body.actionType,
      });
      return NextResponse.json(result, { headers });
    }

    if (action === 'end') {
      const result = await endCallSession(payload);
      return NextResponse.json(result, { headers });
    }

    if (action === 'cancel') {
      const result = await cancelCallSession(enrichedPayload);
      return NextResponse.json(result, { headers });
    }

    if (action === 'rate') {
      const result = await submitCallRating(payload);
      return NextResponse.json(result, { headers });
    }

    if (action === 'host-rate-caller') {
      const result = await submitHostCallerReview(payload);
      return NextResponse.json(result, { headers });
    }

    return NextResponse.json({ error: 'Invalid action provided' }, { status: 400, headers });
  } catch (error: any) {
    console.error('[API/calls POST]', error);
    return NextResponse.json({ error: error.message }, { status: 500, headers });
  }
}
