import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseClient';

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'my_super_secret_verify_token';

// GET request handles webhook verification from Meta
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('WEBHOOK_VERIFIED');
    return new NextResponse(challenge, { status: 200 });
  } else {
    return new NextResponse('Forbidden', { status: 403 });
  }
}

// POST request handles incoming WhatsApp messages and status updates
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.object) {
      if (
        body.entry &&
        body.entry[0].changes &&
        body.entry[0].changes[0] &&
        body.entry[0].changes[0].value.messages &&
        body.entry[0].changes[0].value.messages[0]
      ) {
        const phone_number_id = body.entry[0].changes[0].value.metadata.phone_number_id;
        const from = body.entry[0].changes[0].value.messages[0].from; // sender phone number
        const msg_body = body.entry[0].changes[0].value.messages[0].text?.body;
        const message_id = body.entry[0].changes[0].value.messages[0].id;
        const timestamp = body.entry[0].changes[0].value.messages[0].timestamp;
        
        // Extract the user's name if provided by WhatsApp profile
        const contact_name = body.entry[0].changes[0].value.contacts?.[0]?.profile?.name || 'Unknown';

        console.log(`Received message from ${from}: ${msg_body}`);

        // Save incoming message to Supabase
        if (msg_body) {
          const supabase = createAdminClient();
          
          await supabase.from('whatsapp_messages').insert({
            message_id: message_id,
            sender_phone: from,
            sender_name: contact_name,
            message_body: msg_body,
            direction: 'inbound',
            status: 'received',
            created_at: new Date(timestamp * 1000).toISOString()
          });
        }
      }
      return new NextResponse('EVENT_RECEIVED', { status: 200 });
    } else {
      return new NextResponse('Not Found', { status: 404 });
    }
  } catch (error) {
    console.error('Webhook error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
