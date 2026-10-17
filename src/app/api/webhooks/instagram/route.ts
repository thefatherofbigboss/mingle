import { NextRequest, NextResponse } from 'next/server';
import {
  processIncomingInstagramComment,
  getInstagramCredentials,
} from '@/lib/instagram';

const VERIFY_TOKEN =
  process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN ||
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ||
  'stranger_mingle_instagram_webhook_secret_2026';

// GET request handles webhook verification from Meta
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[Instagram Webhook] Successfully verified with Meta challenge token.');
    return new NextResponse(challenge, { status: 200 });
  } else {
    console.warn('[Instagram Webhook] Forbidden token attempt:', token);
    return new NextResponse('Forbidden', { status: 403 });
  }
}

// POST request handles incoming Instagram comments and mentions
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.object === 'instagram' || body.object === 'page') {
      const { instagramAccountId } = getInstagramCredentials();

      const entries = body.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          if (change.field === 'comments' && change.value) {
            const commentVal = change.value;
            const commentId = commentVal.id;
            const text = commentVal.text;
            const from = commentVal.from;
            const media = commentVal.media;

            // Prevent self-reply feedback loops
            if (from?.id && instagramAccountId && from.id === instagramAccountId) {
              console.log('[Instagram Webhook] Skipping self-comment by account owner.');
              continue;
            }

            console.log(
              `[Instagram Webhook] Received comment from @${from?.username || 'unknown'}: "${text}" (Comment ID: ${commentId})`
            );

            // Execute comment-to-DM workflow asynchronously
            await processIncomingInstagramComment({
              commentId,
              text,
              from: {
                id: from?.id || '',
                username: from?.username || 'unknown',
              },
              media: media
                ? {
                    id: media.id,
                    media_product_type: media.media_product_type,
                  }
                : undefined,
            });
          }
        }
      }

      return new NextResponse('EVENT_RECEIVED', { status: 200 });
    } else {
      return new NextResponse('Not Found', { status: 404 });
    }
  } catch (error: any) {
    console.error('[Instagram Webhook] Error processing event:', error);
    return new NextResponse(
      JSON.stringify({ error: error.message || 'Internal Server Error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
