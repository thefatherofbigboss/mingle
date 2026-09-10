import webpush from 'web-push';
import { createAdminClient } from './supabaseClient';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || 'BChxwzPSfiV0a-BbjUvVsltvjLKblgVNMRTT9eRCIijwYDOXfKBNMdBYqQ46BMuGfHW6YPDahzVNnn5gYQvbGJA';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'ORaGjM9bzqnkFcPwFSQKWywGC_f1CIhA5wodHTHiZ6U';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@strangermingle.com';

try {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} catch (err) {
  console.warn('[PushService] VAPID details initialization warning:', err);
}

export interface CallPushPayload {
  callId: string;
  callRef: string;
  callerName?: string;
  amount?: number;
  durationMinutes?: number;
}

/**
 * Dispatches a high-priority Web Push Notification to all active devices registered by the host.
 * This wakes up the host's device even if the screen is off or the phone is locked.
 */
export async function sendCallPushNotification(hostId: string, callData: CallPushPayload) {
  if (!hostId) return { success: false, reason: 'Missing hostId' };

  const supabase = createAdminClient();
  const { data: subscriptions, error } = await supabase
    .from('host_push_subscriptions')
    .select('id, subscription')
    .eq('host_id', hostId);

  if (error || !subscriptions || subscriptions.length === 0) {
    console.log(`[PushService] No push subscriptions found for host ${hostId}`);
    return { success: false, delivered: 0, reason: 'No subscriptions found' };
  }

  const callerDisplayName = callData.callerName || 'A Member';
  const payload = JSON.stringify({
    title: `📞 Incoming Call from ${callerDisplayName}!`,
    body: `1-on-1 private voice call (${callData.durationMinutes || 15} mins). Tap to answer immediately!`,
    icon: 'https://res.cloudinary.com/strangermingle/image/upload/v1774110968/stranger-mingle-logos_logo-1_uhke6o.png',
    badge: 'https://res.cloudinary.com/strangermingle/image/upload/v1774110968/stranger-mingle-logos_logo-1_uhke6o.png',
    tag: `incoming-call-${callData.callId}`,
    data: {
      callId: callData.callId,
      url: `/phone-a-friend/call/${callData.callId}`,
      timestamp: Date.now(),
    },
    requireInteraction: true,
    vibrate: [500, 250, 500, 250, 500, 250, 500],
    actions: [
      { action: 'answer', title: 'Answer Call 📞' },
      { action: 'view', title: 'Open Dashboard' }
    ]
  });

  const pushOptions = {
    TTL: 60, // Expire after 60 seconds if not delivered (since ringing window is short)
    urgency: 'high' as const,
  };

  let delivered = 0;
  const expiredIds: string[] = [];

  for (const subRow of subscriptions) {
    try {
      const sub = typeof subRow.subscription === 'string' 
        ? JSON.parse(subRow.subscription) 
        : subRow.subscription;

      await webpush.sendNotification(sub, payload, pushOptions);
      delivered++;
      console.log(`[PushService] Successfully sent push notification to host device ${subRow.id}`);
    } catch (err: any) {
      console.error(`[PushService] Failed push to subscription ${subRow.id}:`, err.statusCode || err.message);
      // HTTP 404 or 410 indicates the subscription has expired or is unsubscribed
      if (err.statusCode === 404 || err.statusCode === 410) {
        expiredIds.push(subRow.id);
      }
    }
  }

  // Cleanup expired subscriptions
  if (expiredIds.length > 0) {
    await supabase
      .from('host_push_subscriptions')
      .delete()
      .in('id', expiredIds);
    console.log(`[PushService] Cleaned up ${expiredIds.length} expired push subscriptions`);
  }

  return { success: delivered > 0, delivered };
}
