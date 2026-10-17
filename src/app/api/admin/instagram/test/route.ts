import { NextRequest, NextResponse } from 'next/server';
import { processIncomingInstagramComment } from '@/lib/instagram';
import { createAdminClient } from '@/lib/supabaseClient';

export async function POST(request: NextRequest) {
  try {
    const secretHeader = request.headers.get('x-internal-api-secret');
    if (secretHeader !== process.env.INTERNAL_API_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { username = 'test_user', commentText = 'tickets please', mediaId = 'test_media_123', dryRun = false } = await request.json();

    if (!commentText || !commentText.trim()) {
      return NextResponse.json({ error: 'Comment text is required.' }, { status: 400 });
    }

    if (dryRun) {
      // Just test matching logic
      const supabase = createAdminClient();
      const { data: automations } = await supabase
        .from('instagram_automations')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      const cleanComment = commentText.trim().toLowerCase();
      let matched = null;

      for (const rule of automations || []) {
        if (rule.post_type === 'specific_post' && rule.post_id) {
          if (!mediaId.includes(rule.post_id) && !rule.post_id.includes(mediaId)) continue;
        }

        if (rule.match_type === 'any') {
          matched = rule;
          break;
        }

        const keywords = (rule.keywords || []).map((k: string) => k.trim().toLowerCase());
        if (rule.match_type === 'exact') {
          if (keywords.includes(cleanComment)) {
            matched = rule;
            break;
          }
        } else {
          if (keywords.some((k: string) => cleanComment.includes(k))) {
            matched = rule;
            break;
          }
        }
      }

      return NextResponse.json({
        dryRun: true,
        matched: !!matched,
        matchedRule: matched,
        simulatedComment: commentText,
        simulatedUser: username,
      });
    }

    // Full simulated run
    const simulatedCommentId = `test_cmt_${Date.now()}`;
    const result = await processIncomingInstagramComment({
      commentId: simulatedCommentId,
      text: commentText,
      from: {
        id: `sim_ig_${Date.now()}`,
        username,
      },
      media: {
        id: mediaId,
        media_product_type: 'FEED',
      },
    });

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error: any) {
    console.error('[Instagram Admin Test] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to run test' },
      { status: 500 }
    );
  }
}
