import { createAdminClient } from './supabaseClient';
import { generateVoiceToken, getAgoraAppId, isAgoraConfigured } from './agoraService';
import { v4 as uuidv4 } from 'uuid';

function getDb() {
  return createAdminClient();
}

/**
 * Calculates user age in years from Date of Birth.
 * Returns formatted string like "24 yrs" or "Not shared".
 */
export function calculateAge(dobString: string | null | undefined): string {
  if (!dobString) return 'Not shared';
  try {
    const dob = new Date(dobString);
    if (isNaN(dob.getTime())) return 'Not shared';
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) {
      age--;
    }
    if (age <= 0 || age > 120) return 'Not shared';
    return `${age} yrs`;
  } catch {
    return 'Not shared';
  }
}

/**
 * Normalizes gender display.
 */
export function formatGender(genderString: string | null | undefined): string {
  if (!genderString || !genderString.trim()) return 'Not specified';
  const clean = genderString.trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

async function resolveCanonicalUserId(db: any, identifier?: string | null): Promise<string | null> {
  if (!identifier || identifier === 'public') return null;

  // 1. Direct ID check
  const { data: direct } = await db.from('users').select('id').eq('id', identifier).maybeSingle();
  if (direct) return direct.id;

  // 2. Lookup by subscription user_id or customer_email
  const { data: sub } = await db
    .from('user_subscriptions')
    .select('user_id')
    .or(`user_id.eq.${identifier},customer_email.eq.${identifier}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sub?.user_id) return sub.user_id;

  // 3. Lookup by email in users table
  const { data: byEmail } = await db.from('users').select('id').eq('email', identifier).maybeSingle();
  if (byEmail) return byEmail.id;

  return identifier;
}

/**
 * Retrieves the current member's own calling availability and credit balance.
 */
export async function getMemberSelfStatus(userId: string) {
  const db = getDb();
  const canonicalId = await resolveCanonicalUserId(db, userId);
  if (!canonicalId) return null;

  const { data: user } = await db
    .from('users')
    .select('id, is_call_available, call_status, credits')
    .eq('id', canonicalId)
    .maybeSingle();

  if (!user) return null;

  const rawStatus = user.call_status || 'idle';
  return {
    userId: user.id,
    isCallAvailable: Boolean(user.is_call_available),
    callStatus: rawStatus === 'online' ? 'idle' : rawStatus,
    credits: Number(user.credits || 0),
  };
}

/**
 * Fetches all online & available verified members (active within 15 mins).
 * Excludes the requesting user and any blocked users.
 */
export async function getOnlineMembers(currentUserId?: string | null) {
  const db = getDb();
  // Cutoff for active presence: 15 minutes of heartbeat inactivity
  const heartbeatCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const canonicalCurrentUserId = await resolveCanonicalUserId(db, currentUserId);

  // 1. Fetch real active members (including verified hosts/admins) who are available for calls
  let query = db
    .from('users')
    .select(`
      id,
      anonymous_alias,
      avatar_url,
      bio,
      gender,
      date_of_birth,
      call_status,
      member_call_rating_avg,
      member_call_rating_count,
      last_call_heartbeat,
      is_call_available,
      updated_at
    `)
    .eq('is_active', true)
    .in('role', ['member', 'host', 'admin'])
    .eq('is_call_available', true)
    .neq('call_status', 'offline')
    .or(`last_call_heartbeat.gte.${heartbeatCutoff},last_call_heartbeat.is.null`)
    .order('last_call_heartbeat', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })
    .limit(30);

  if (canonicalCurrentUserId) {
    query = query.neq('id', canonicalCurrentUserId);
  }

  const { data: members, error } = await query;

  if (error) {
    console.error('[MemberCallsService] Error fetching online members:', error);
    throw new Error(error.message);
  }

  // 2. Fetch blocked users to exclude if current user is provided
  let blockedUserIds: string[] = [];
  if (canonicalCurrentUserId) {
    try {
      const { data: blocks } = await db
        .from('user_blocks')
        .select('blocked_id')
        .eq('blocker_id', canonicalCurrentUserId);
      if (blocks) {
        blockedUserIds = blocks.map((b: any) => b.blocked_id);
      }
    } catch (err) {
      console.warn('[MemberCallsService] Blocked check warning:', err);
    }
  }

  // 3. Format public attributes safely (never expose real name, email, or phone)
  return (members || [])
    .filter((m: any) => !blockedUserIds.includes(m.id))
    .map((m: any) => {
      const rawStatus = m.call_status || 'idle';
      const cleanStatus = rawStatus === 'online' ? 'idle' : rawStatus;
      return {
        id: m.id,
        anonymousAlias: m.anonymous_alias || `Member_${m.id.slice(0, 6)}`,
        avatarUrl: m.avatar_url || null,
        bio: m.bio || '',
        gender: formatGender(m.gender),
        age: calculateAge(m.date_of_birth),
        callStatus: m.is_call_available ? cleanStatus : 'offline',
        ratingAvg: Number(m.member_call_rating_avg || 5.0).toFixed(1),
        ratingCount: m.member_call_rating_count || 0,
      };
    });
}

/**
 * Toggles a member's calling availability mode (Online / Offline).
 */
export async function toggleMemberAvailability(userId: string, isAvailable: boolean) {
  const db = getDb();
  const now = new Date().toISOString();

  const canonicalId = (await resolveCanonicalUserId(db, userId)) || userId;

  const { data, error } = await db
    .from('users')
    .update({
      is_call_available: isAvailable,
      last_call_heartbeat: now,
      call_status: isAvailable ? 'idle' : 'offline',
      updated_at: now,
    })
    .eq('id', canonicalId)
    .select('id, is_call_available, call_status')
    .maybeSingle();

  if (error || !data) {
    console.error('[MemberCallsService] Toggle availability error:', error);
    throw new Error(error?.message || 'User account not found to update availability');
  }

  return { success: true, isCallAvailable: data.is_call_available, callStatus: data.call_status, userId: data.id };
}

/**
 * Refreshes member's calling heartbeat (keeps online presence active).
 */
export async function sendMemberCallHeartbeat(userId: string) {
  const db = getDb();
  const now = new Date().toISOString();

  const canonicalId = (await resolveCanonicalUserId(db, userId)) || userId;

  await db
    .from('users')
    .update({
      last_call_heartbeat: now,
    })
    .eq('id', canonicalId);

  return { success: true };
}

/**
 * Initiates a 1-on-1 voice call from Caller to Receiver.
 */
export async function initiateMemberCall({
  callerId,
  receiverId,
}: {
  callerId: string;
  receiverId: string;
}) {
  const db = getDb();

  if (!callerId || !receiverId) {
    throw new Error('Caller ID and Receiver ID are required.');
  }

  const canonicalCallerId = (await resolveCanonicalUserId(db, callerId)) || callerId;
  const canonicalReceiverId = (await resolveCanonicalUserId(db, receiverId)) || receiverId;

  if (canonicalCallerId === canonicalReceiverId) {
    throw new Error('You cannot call yourself.');
  }

  // 1. Verify Caller: Must be active and have at least 10 credits (1 minute minimum)
  const { data: caller, error: callerErr } = await db
    .from('users')
    .select('id, anonymous_alias, avatar_url, credits, is_active, call_status, gender, date_of_birth')
    .eq('id', canonicalCallerId)
    .single();

  if (callerErr || !caller || !caller.is_active) {
    throw new Error('Caller account not found or is inactive.');
  }

  const callerCredits = Number(caller.credits || 0);
  if (callerCredits < 10) {
    throw new Error(`Insufficient credits. You need at least 10 credits to make a call (you have ${callerCredits} credits). Please recharge.`);
  }

  if (caller.call_status === 'in_call' || caller.call_status === 'ringing') {
    throw new Error('You are already participating in another call.');
  }

  // 2. Verify Receiver: Must be active, online, and not busy
  const { data: receiver, error: receiverErr } = await db
    .from('users')
    .select('id, anonymous_alias, avatar_url, is_active, is_call_available, call_status, gender, date_of_birth')
    .eq('id', canonicalReceiverId)
    .single();

  if (receiverErr || !receiver || !receiver.is_active) {
    throw new Error('This member is unavailable.');
  }

  if (!receiver.is_call_available) {
    throw new Error('This member has set their status to Offline.');
  }

  if (receiver.call_status === 'in_call' || receiver.call_status === 'ringing') {
    throw new Error('This member is currently busy on another call. Please try again later.');
  }

  // 3. Generate call session credentials
  const callRef = `MC-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const agoraChannelName = `mc_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

  // 4. Create Call Record in member_to_member_calls
  const { data: call, error: callErr } = await db
    .from('member_to_member_calls')
    .insert({
      call_ref: callRef,
      caller_id: canonicalCallerId,
      receiver_id: canonicalReceiverId,
      status: 'ringing',
      agora_channel_name: agoraChannelName,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select(`
      *,
      caller:users!caller_id(id, anonymous_alias, avatar_url, gender, date_of_birth),
      receiver:users!receiver_id(id, anonymous_alias, avatar_url, gender, date_of_birth)
    `)
    .single();

  if (callErr) {
    console.error('[MemberCallsService] Call creation error:', callErr);
    throw new Error(callErr.message);
  }

  // 5. Update both users' status to 'ringing'
  await db
    .from('users')
    .update({ call_status: 'ringing' })
    .in('id', [callerId, receiverId]);

  return {
    success: true,
    call: {
      ...call,
      callerAge: calculateAge(call.caller?.date_of_birth),
      callerGender: formatGender(call.caller?.gender),
      receiverAge: calculateAge(call.receiver?.date_of_birth),
      receiverGender: formatGender(call.receiver?.gender),
    },
  };
}

/**
 * Responds to an incoming member call (Accept or Reject).
 */
export async function respondToMemberCall({
  callId,
  responderId,
  action,
}: {
  callId: string;
  responderId: string;
  action: 'accept' | 'reject';
}) {
  const db = getDb();

  const { data: call, error: callErr } = await db
    .from('member_to_member_calls')
    .select('*')
    .eq('id', callId)
    .single();

  if (callErr || !call) {
    throw new Error('Call session not found.');
  }

  if (call.receiver_id !== responderId) {
    throw new Error('Unauthorized to respond to this call.');
  }

  if (call.status !== 'ringing') {
    throw new Error(`Call is no longer ringing (current status: ${call.status}).`);
  }

  const now = new Date().toISOString();

  if (action === 'accept') {
    const { data: updatedCall, error: updateErr } = await db
      .from('member_to_member_calls')
      .update({
        status: 'accepted',
        started_at: now,
        updated_at: now,
      })
      .eq('id', callId)
      .select()
      .single();

    if (updateErr) throw new Error(updateErr.message);

    // Set both users to 'in_call'
    await db
      .from('users')
      .update({ call_status: 'in_call' })
      .in('id', [call.caller_id, call.receiver_id]);

    return { success: true, status: 'accepted', call: updatedCall };
  } else {
    // Reject call
    const { data: updatedCall, error: updateErr } = await db
      .from('member_to_member_calls')
      .update({
        status: 'rejected',
        ended_at: now,
        updated_at: now,
      })
      .eq('id', callId)
      .select()
      .single();

    if (updateErr) throw new Error(updateErr.message);

    // Reset both users to 'idle'
    await db
      .from('users')
      .update({ call_status: 'idle' })
      .in('id', [call.caller_id, call.receiver_id]);

    return { success: true, status: 'rejected', call: updatedCall };
  }
}

/**
 * Caller cancels call while still ringing.
 */
export async function cancelMemberCall({
  callId,
  callerId,
}: {
  callId: string;
  callerId: string;
}) {
  const db = getDb();

  const { data: call } = await db
    .from('member_to_member_calls')
    .select('id, caller_id, receiver_id, status')
    .eq('id', callId)
    .single();

  if (!call || call.status !== 'ringing') {
    return { success: false, message: 'Call not active or already handled' };
  }

  const now = new Date().toISOString();
  await db
    .from('member_to_member_calls')
    .update({
      status: 'cancelled',
      ended_at: now,
      updated_at: now,
    })
    .eq('id', callId);

  // Reset users to idle
  await db
    .from('users')
    .update({ call_status: 'idle' })
    .in('id', [call.caller_id, call.receiver_id]);

  return { success: true };
}

/**
 * Ends an active call session and handles per-minute billing (10 credits/minute).
 * NO EMAIL OR PDF IS DISPATCHED.
 */
export async function endMemberCall({
  callId,
  requesterId,
}: {
  callId: string;
  requesterId: string;
}) {
  const db = getDb();

  const { data: call, error: callErr } = await db
    .from('member_to_member_calls')
    .select('*')
    .eq('id', callId)
    .single();

  if (callErr || !call) {
    throw new Error('Call session not found.');
  }

  // If already finished, return current state
  if (['completed', 'rejected', 'cancelled', 'missed'].includes(call.status)) {
    return { success: true, call };
  }

  const now = new Date();
  const startTime = call.started_at ? new Date(call.started_at) : null;

  let durationSeconds = 0;
  let billedMinutes = 0;
  let creditsToDeduct = 0;
  let finalStatus = 'completed';

  // Only compute billing and duration if the call was accepted by the other member
  const wasAccepted = (call.status === 'accepted' || call.status === 'in_call') && !!call.started_at;

  if (wasAccepted && startTime) {
    durationSeconds = Math.max(0, Math.round((now.getTime() - startTime.getTime()) / 1000));
    billedMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
    creditsToDeduct = billedMinutes * 10; // Exactly 10 credits per minute
    finalStatus = 'completed';
  } else {
    // Call ended before being accepted by receiver (ringing state / cancelled / rejected)
    finalStatus = 'cancelled';
    durationSeconds = 0;
    billedMinutes = 0;
    creditsToDeduct = 0;
  }

  // 1. Deduct credits from caller (if call was connected)
  let remainingCredits = 0;
  if (creditsToDeduct > 0 && call.caller_id) {
    const { data: callerUser } = await db
      .from('users')
      .select('credits')
      .eq('id', call.caller_id)
      .single();

    const currentBalance = callerUser?.credits || 0;
    remainingCredits = Math.max(0, currentBalance - creditsToDeduct);

    await db
      .from('users')
      .update({
        credits: remainingCredits,
        updated_at: now.toISOString(),
      })
      .eq('id', call.caller_id);

    console.log(`[MemberCallsService] Deducted ${creditsToDeduct} credits from caller ${call.caller_id}. Duration: ${durationSeconds}s (${billedMinutes} mins). New Balance: ${remainingCredits}`);
  }

  // 2. Update call record
  const { data: updatedCall, error: updateErr } = await db
    .from('member_to_member_calls')
    .update({
      status: finalStatus,
      ended_at: now.toISOString(),
      duration_seconds: durationSeconds,
      billed_minutes: billedMinutes,
      credits_deducted: creditsToDeduct,
      updated_at: now.toISOString(),
    })
    .eq('id', callId)
    .select()
    .single();

  if (updateErr) {
    console.error('[MemberCallsService] Error updating call on end:', updateErr);
    throw new Error(updateErr.message);
  }

  // 3. Reset both users to 'idle'
  await db
    .from('users')
    .update({ call_status: 'idle' })
    .in('id', [call.caller_id, call.receiver_id]);

  return {
    success: true,
    call: updatedCall,
    durationSeconds,
    billedMinutes,
    creditsDeducted: creditsToDeduct,
    remainingCredits,
  };
}

/**
 * Generates Agora RTC Voice Token for a call participant.
 */
export async function getMemberCallToken({
  callId,
  requesterId,
}: {
  callId: string;
  requesterId: string;
}) {
  const db = getDb();

  const { data: call, error } = await db
    .from('member_to_member_calls')
    .select('*')
    .eq('id', callId)
    .single();

  if (error || !call) throw new Error('Call session not found.');

  if (call.caller_id !== requesterId && call.receiver_id !== requesterId) {
    throw new Error('Unauthorized: You are not a participant in this call.');
  }

  const tokenParams = {
    channelName: call.agora_channel_name,
    account: requesterId,
    role: 'publisher' as const,
    expireSeconds: 7200,
  };

  const tokenData = generateVoiceToken(tokenParams);

  return {
    appId: tokenData.appId,
    channelName: tokenData.channelName,
    token: tokenData.token,
    account: requesterId,
    call,
  };
}

/**
 * Submits a rating (1-5 stars) and optional review after a member call.
 */
export async function submitMemberCallRating({
  callId,
  userId,
  rating,
  review,
}: {
  callId: string;
  userId: string;
  rating: number;
  review?: string;
}) {
  const db = getDb();
  const cleanRating = Math.max(1, Math.min(5, Math.round(rating)));

  const { data: call } = await db
    .from('member_to_member_calls')
    .select('*')
    .eq('id', callId)
    .single();

  if (!call) throw new Error('Call session not found.');

  const isCaller = call.caller_id === userId;
  const isReceiver = call.receiver_id === userId;

  if (!isCaller && !isReceiver) throw new Error('Unauthorized');

  const updatePayload = isCaller
    ? { caller_rating: cleanRating, caller_review: review || null }
    : { receiver_rating: cleanRating, receiver_review: review || null };

  await db
    .from('member_to_member_calls')
    .update({ ...updatePayload, updated_at: new Date().toISOString() })
    .eq('id', callId);

  // Recalculate rating average for target user
  const targetUserId = isCaller ? call.receiver_id : call.caller_id;

  try {
    const { data: allReceivedRatings } = await db
      .from('member_to_member_calls')
      .select('caller_rating, receiver_rating, caller_id, receiver_id')
      .or(`caller_id.eq.${targetUserId},receiver_id.eq.${targetUserId}`);

    if (allReceivedRatings && allReceivedRatings.length > 0) {
      let sum = 0;
      let count = 0;
      for (const r of allReceivedRatings) {
        if (r.caller_id === targetUserId && r.receiver_rating) {
          sum += r.receiver_rating;
          count++;
        }
        if (r.receiver_id === targetUserId && r.caller_rating) {
          sum += r.caller_rating;
          count++;
        }
      }

      if (count > 0) {
        const avg = (sum / count).toFixed(2);
        await db
          .from('users')
          .update({
            member_call_rating_avg: avg,
            member_call_rating_count: count,
          })
          .eq('id', targetUserId);
      }
    }
  } catch (ratingErr) {
    console.warn('[MemberCallsService] Rating aggregation warning:', ratingErr);
  }

  return { success: true };
}

/**
 * Checks if a member has an active incoming call.
 */
export async function getActiveIncomingCallForMember(memberId: string) {
  const db = getDb();
  const sixtySecondsAgo = new Date(Date.now() - 60 * 1000).toISOString();

  const { data: call } = await db
    .from('member_to_member_calls')
    .select(`
      *,
      caller:users!caller_id(id, anonymous_alias, avatar_url, gender, date_of_birth)
    `)
    .eq('receiver_id', memberId)
    .eq('status', 'ringing')
    .gte('created_at', sixtySecondsAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!call) return null;

  return {
    ...call,
    callerAge: calculateAge(call.caller?.date_of_birth),
    callerGender: formatGender(call.caller?.gender),
  };
}
