import { NextRequest, NextResponse } from 'next/server';
import { 
  getApprovedCallingHosts, 
  getHostCallingDetails, 
  createCallPaymentOrder,
  initiateCall, 
  respondToCall, 
  endCallSession, 
  submitCallRating 
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
 * GET /api/calls: List approved calling hosts or a specific host's details.
 */
export async function GET(req: NextRequest) {
  const headers = corsHeaders(req);
  try {
    const { searchParams } = new URL(req.url);
    const hostId = searchParams.get('hostId');

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

    if (action === 'create-order' || action === 'create-payment-order') {
      const result = await createCallPaymentOrder(payload);
      return NextResponse.json(result, { headers });
    }

    if (action === 'initiate') {
      const result = await initiateCall(payload);
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

    if (action === 'rate') {
      const result = await submitCallRating(payload);
      return NextResponse.json(result, { headers });
    }

    return NextResponse.json({ error: 'Invalid action provided' }, { status: 400, headers });
  } catch (error: any) {
    console.error('[API/calls POST]', error);
    return NextResponse.json({ error: error.message }, { status: 500, headers });
  }
}
