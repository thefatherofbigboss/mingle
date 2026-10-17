import { createAdminClient } from './supabaseClient';

export interface InstagramCommentPayload {
  commentId: string;
  text: string;
  from: {
    id: string;
    username: string;
  };
  media?: {
    id: string;
    media_product_type?: string;
  };
}

export interface InstagramPrivateReplyOptions {
  commentId: string;
  text: string;
  igUserId?: string;
}

export interface InstagramCommentReplyOptions {
  commentId: string;
  message: string;
}

export function getInstagramCredentials() {
  const token =
    process.env.INSTAGRAM_PAGE_ACCESS_TOKEN ||
    process.env.META_SYSTEM_USER_TOKEN;

  const instagramAccountId =
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ||
    process.env.META_INSTAGRAM_ACCOUNT_ID ||
    'me';

  return { token, instagramAccountId };
}

/**
 * Send an Instagram Private Reply Direct Message to a user who commented on a post.
 * Meta Graph API allows 1 direct message to be sent to a commenter within 7 days of the comment.
 */
export async function sendInstagramPrivateReply({
  commentId,
  text,
  igUserId,
}: InstagramPrivateReplyOptions) {
  const { token, instagramAccountId } = getInstagramCredentials();

  if (!token) {
    throw new Error('Meta/Instagram access token not configured in environment variables.');
  }

  const endpoint = `https://graph.facebook.com/v21.0/${instagramAccountId}/messages`;

  // Standard Instagram Private Reply payload targeting comment_id
  const payload: any = {
    recipient: commentId ? { comment_id: commentId } : { id: igUserId },
    message: {
      text,
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('[Instagram Graph API] Error sending private reply:', data);
    const errMsg = data?.error?.message || JSON.stringify(data);
    throw new Error(`Failed to send Instagram DM: ${errMsg}`);
  }

  return data;
}

/**
 * Post a public reply to an Instagram comment.
 */
export async function postInstagramCommentReply({
  commentId,
  message,
}: InstagramCommentReplyOptions) {
  const { token } = getInstagramCredentials();

  if (!token) {
    throw new Error('Meta/Instagram access token not configured in environment variables.');
  }

  const endpoint = `https://graph.facebook.com/v21.0/${commentId}/replies`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('[Instagram Graph API] Error posting comment reply:', data);
    const errMsg = data?.error?.message || JSON.stringify(data);
    throw new Error(`Failed to post public reply on Instagram: ${errMsg}`);
  }

  return data;
}

/**
 * Match comment text and media ID against active automations and trigger actions
 */
export async function processIncomingInstagramComment(payload: InstagramCommentPayload) {
  const supabase = createAdminClient();

  // 1. Fetch active automation rules
  const { data: automations, error: autoError } = await supabase
    .from('instagram_automations')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (autoError || !automations || automations.length === 0) {
    console.log('[Instagram Webhook] No active automations found.');
    return { matched: false, reason: 'No active rules' };
  }

  const cleanCommentText = (payload.text || '').trim().toLowerCase();
  const rawMediaId = payload.media?.id || '';

  // 2. Find first matching rule
  let matchedRule: any = null;

  for (const rule of automations) {
    // Check post targeting
    if (rule.post_type === 'specific_post' && rule.post_id) {
      const targetPostId = rule.post_id.trim();
      if (rawMediaId && !rawMediaId.includes(targetPostId) && !targetPostId.includes(rawMediaId)) {
        continue;
      }
    }

    // Check keyword matching
    if (rule.match_type === 'any') {
      matchedRule = rule;
      break;
    }

    const keywords = (rule.keywords || []).map((k: string) => k.trim().toLowerCase()).filter(Boolean);

    if (keywords.length === 0) {
      matchedRule = rule;
      break;
    }

    if (rule.match_type === 'exact') {
      const isExact = keywords.some((k: string) => k === cleanCommentText);
      if (isExact) {
        matchedRule = rule;
        break;
      }
    } else {
      // 'contains'
      const isContained = keywords.some((k: string) => cleanCommentText.includes(k));
      if (isContained) {
        matchedRule = rule;
        break;
      }
    }
  }

  if (!matchedRule) {
    console.log(`[Instagram Webhook] Comment "${payload.text}" did not match any active rule.`);
    return { matched: false, reason: 'No keyword match' };
  }

  console.log(`[Instagram Webhook] Matched rule "${matchedRule.name}" for comment "${payload.text}" from @${payload.from?.username}`);

  // 3. Format dynamic message variables
  const username = payload.from?.username || 'friend';
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://strangermingle.in';
  const eventLink = `${siteUrl}/events`;

  const formattedDm = matchedRule.dm_message
    .replace(/\{\{username\}\}/gi, `@${username}`)
    .replace(/\{\{name\}\}/gi, username)
    .replace(/\{\{event_link\}\}/gi, eventLink)
    .replace(/\{\{site_url\}\}/gi, siteUrl);

  const formattedPublicReply = matchedRule.public_reply
    ? matchedRule.public_reply
        .replace(/\{\{username\}\}/gi, `@${username}`)
        .replace(/\{\{name\}\}/gi, username)
        .replace(/\{\{event_link\}\}/gi, eventLink)
    : null;

  let dmSuccess = false;
  let publicReplySuccess = false;
  let errorMessage: string | null = null;

  // 4. Send the Direct Message via Instagram Private Reply API
  try {
    await sendInstagramPrivateReply({
      commentId: payload.commentId,
      text: formattedDm,
      igUserId: payload.from?.id,
    });
    dmSuccess = true;
  } catch (dmErr: any) {
    console.error('[Instagram Webhook] Failed to send private reply:', dmErr);
    errorMessage = `DM Error: ${dmErr.message}`;
  }

  // 5. Optionally post a public comment reply
  if (formattedPublicReply) {
    try {
      await postInstagramCommentReply({
        commentId: payload.commentId,
        message: formattedPublicReply,
      });
      publicReplySuccess = true;
    } catch (pubErr: any) {
      console.error('[Instagram Webhook] Failed to post public reply:', pubErr);
      if (!errorMessage) {
        errorMessage = `Comment Reply Error: ${pubErr.message}`;
      }
    }
  }

  // 6. Record to instagram_logs
  await supabase.from('instagram_logs').insert({
    automation_id: matchedRule.id,
    automation_name: matchedRule.name,
    comment_id: payload.commentId,
    ig_username: payload.from?.username || 'unknown',
    ig_user_id: payload.from?.id || null,
    media_id: rawMediaId || null,
    comment_text: payload.text,
    dm_text: formattedDm,
    public_reply_text: formattedPublicReply,
    status: dmSuccess ? 'sent' : 'failed',
    error_message: errorMessage,
  });

  // 7. Increment trigger count on automation
  await supabase
    .from('instagram_automations')
    .update({
      trigger_count: (matchedRule.trigger_count || 0) + 1,
      last_triggered_at: new Date().toISOString(),
    })
    .eq('id', matchedRule.id);

  return {
    matched: true,
    ruleId: matchedRule.id,
    ruleName: matchedRule.name,
    dmSent: dmSuccess,
    publicReplySent: publicReplySuccess,
    error: errorMessage,
  };
}
