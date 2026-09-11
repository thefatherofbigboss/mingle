import { NextRequest, NextResponse } from 'next/server';
import { getMemberCallToken } from '@/lib/memberCallsService';

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

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);
  try {
    const { callId, requesterId } = await req.json();

    if (!callId || !requesterId) {
      return NextResponse.json(
        { error: 'Missing required parameters: callId and requesterId' },
        { status: 400, headers }
      );
    }

    const sessionData = await getMemberCallToken({ callId, requesterId });
    return NextResponse.json(sessionData, { headers });
  } catch (error: any) {
    console.error('[API/members/calls/token POST]', error);
    return NextResponse.json({ error: error.message }, { status: 500, headers });
  }
}
