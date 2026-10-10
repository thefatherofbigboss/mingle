import { NextRequest, NextResponse } from 'next/server';
import { sendWhatsAppTextMessage } from '@/lib/whatsapp';
import { createAdminClient } from '@/lib/supabaseClient';

export async function POST(request: NextRequest) {
  try {
    const secretHeader = request.headers.get('x-internal-api-secret');
    if (secretHeader !== process.env.INTERNAL_API_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { to, text, senderName = 'Stranger Mingle Support' } = await request.json();

    if (!to || !text || !text.trim()) {
      return NextResponse.json({ error: 'Recipient phone ("to") and message "text" are required.' }, { status: 400 });
    }

    const metaRes = await sendWhatsAppTextMessage(to, text.trim());
    const messageId = metaRes?.messages?.[0]?.id || `outbound_${Date.now()}`;

    // Record in whatsapp_messages table
    const supabase = createAdminClient();
    const cleanPhone = to.replace(/\D/g, '');
    const { data: inserted, error: dbError } = await (supabase
      .from('whatsapp_messages') as any)
      .insert({
        message_id: messageId,
        sender_phone: cleanPhone,
        sender_name: senderName,
        message_body: text.trim(),
        direction: 'outbound',
        status: 'sent',
      })
      .select()
      .single();

    if (dbError) {
      console.error('Failed to log outbound message in whatsapp_messages:', dbError);
    }

    return NextResponse.json({
      success: true,
      messageId,
      data: inserted,
    });
  } catch (error: any) {
    console.error('Failed to send WhatsApp reply:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to send WhatsApp message' },
      { status: 500 }
    );
  }
}
