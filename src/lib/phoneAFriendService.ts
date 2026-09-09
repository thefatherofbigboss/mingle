import { createAdminClient } from './supabaseClient';
import { generateVoiceToken, getAgoraAppId, isAgoraConfigured } from './agoraService';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { SM_UUID_NAMESPACE } from './userProfile';
import { createRazorpayOrder, verifyRazorpaySignature } from './razorpay';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Ensures any identifier (UUID or custom string like 'user_xxx') maps to a valid UUID.
 */
export function resolveCallerUuid(id: string): string {
  if (!id) return uuidv4();
  if (UUID_REGEX.test(id)) return id;
  return uuidv5(id, SM_UUID_NAMESPACE);
}

/**
 * Ensures a user record exists in public.users to satisfy foreign key constraint.
 */
async function ensureCallerUserExists(db: any, userId: string) {
  const { data: existingUser } = await db
    .from('users')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (!existingUser) {
    const shortId = userId.replace(/-/g, '').slice(0, 8);
    const { error } = await db.from('users').insert({
      id: userId,
      username: `caller_${shortId}`,
      email: `caller_${shortId}@caller.strangermingle.internal`,
      anonymous_alias: `Caller_${shortId.toUpperCase()}`,
      role: 'member',
      is_active: true,
      is_verified: false,
    });
    if (error && error.code !== '23505') {
      console.error('[PhoneAFriendService] Error auto-creating caller user:', error);
    }
  }
}

/**
 * Service providing core logic for "Just Talk - Phone a Friend" 1-on-1 audio calls.
 */

// Helper to get admin supabase client
function getDb() {
  return createAdminClient();
}

/**
 * Fetches all hosts who are approved for Phone a Friend calling.
 * Returned list includes their host profile details, calling settings, and whether they are online.
 */
export async function getApprovedCallingHosts() {
  const db = getDb();

  const { data, error } = await db
    .from('phone_a_friend_host_settings')
    .select(`
      id,
      host_id,
      is_enabled,
      is_online,
      last_seen_at,
      languages,
      topics,
      rate_per_session,
      session_duration_minutes,
      bio,
      tagline,
      total_calls_completed,
      rating_avg,
      rating_count,
      host:host_profiles!host_id (
        id,
        display_name,
        profile_image,
        city,
        state,
        description,
        is_approved
      )
    `)
    .eq('is_enabled', true)
    .order('is_online', { ascending: false })
    .order('rating_avg', { ascending: false });

  if (error) {
    console.error('[PhoneAFriendService] Error fetching approved hosts:', error);
    throw new Error(error.message);
  }

  return data || [];
}

/**
 * Fetches calling details for a specific host, including upcoming available slots.
 */
export async function getHostCallingDetails(hostId: string) {
  const db = getDb();

  const { data: settings, error: settingsError } = await db
    .from('phone_a_friend_host_settings')
    .select(`
      *,
      host:host_profiles!host_id (
        id,
        display_name,
        profile_image,
        city,
        description
      )
    `)
    .eq('host_id', hostId)
    .maybeSingle();

  if (settingsError) {
    console.error('[PhoneAFriendService] Error fetching host details:', settingsError);
    throw new Error(settingsError.message);
  }

  // Also fetch upcoming slots (both available and booked)
  const now = new Date().toISOString();
  const { data: slots } = await db
    .from('phone_a_friend_slots')
    .select('*')
    .eq('host_id', hostId)
    .in('status', ['available', 'booked'])
    .gte('start_time', now)
    .order('start_time', { ascending: true })
    .limit(30);

  return {
    settings,
    slots: slots || [],
  };
}

/**
 * Updates host calling settings (bio, languages, topics, pricing).
 * Automatically initializes row if it doesn't exist yet.
 */
export async function updateHostCallingSettings(hostId: string, payload: Record<string, any>) {
  const db = getDb();

  const { data: existing } = await db
    .from('phone_a_friend_host_settings')
    .select('id')
    .eq('host_id', hostId)
    .maybeSingle();

  const updateData = {
    ...payload,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { data, error } = await db
      .from('phone_a_friend_host_settings')
      .update(updateData)
      .eq('host_id', hostId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  } else {
    const { data, error } = await db
      .from('phone_a_friend_host_settings')
      .insert({
        host_id: hostId,
        ...updateData,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }
}

/**
 * Host toggles their online presence.
 */
export async function toggleHostOnlinePresence(hostId: string, isOnline: boolean) {
  const db = getDb();

  const now = new Date().toISOString();
  return updateHostCallingSettings(hostId, {
    is_online: isOnline,
    last_seen_at: now,
  });
}

/**
 * Host creates bookable time slots.
 */
export async function createHostSlots(hostId: string, slots: Array<{
  slotDate: string;
  startTime: string;
  endTime: string;
  price?: number;
}>) {
  const db = getDb();

  const rows = slots.map((s) => ({
    host_id: hostId,
    slot_date: s.slotDate,
    start_time: s.startTime,
    end_time: s.endTime,
    price: s.price ?? 99.0,
    status: 'available',
  }));

  const { data, error } = await db
    .from('phone_a_friend_slots')
    .insert(rows)
    .select();

  if (error) {
    console.error('[PhoneAFriendService] Error creating slots:', error);
    throw new Error(error.message);
  }

  return data;
}

/**
 * Deletes an available slot.
 */
export async function deleteHostSlot(slotId: string, hostId: string) {
  const db = getDb();

  const { error } = await db
    .from('phone_a_friend_slots')
    .delete()
    .eq('id', slotId)
    .eq('host_id', hostId)
    .eq('status', 'available');

  if (error) throw new Error(error.message);
  return { success: true };
}

/**
 * Fetches all slots for a host (including booked/past).
 */
export async function getHostSlots(hostId: string) {
  const db = getDb();

  const { data, error } = await db
    .from('phone_a_friend_slots')
    .select('*')
    .eq('host_id', hostId)
    .order('start_time', { ascending: true });

  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Creates a Razorpay payment order for an instant call or scheduled slot booking.
 */
export async function createCallPaymentOrder({
  userId,
  hostId,
  callType = 'instant',
  slotId = null,
  amount,
}: {
  userId: string;
  hostId: string;
  callType?: 'instant' | 'scheduled';
  slotId?: string | null;
  amount?: number;
}) {
  const db = getDb();
  const resolvedUserId = resolveCallerUuid(userId);
  await ensureCallerUserExists(db, resolvedUserId);

  // Fetch host settings
  const { data: hostSettings, error: hostError } = await db
    .from('phone_a_friend_host_settings')
    .select('is_enabled, is_online, rate_per_session')
    .eq('host_id', hostId)
    .single();

  if (hostError || !hostSettings?.is_enabled) {
    throw new Error('This host is currently not available for calls.');
  }

  if (callType === 'instant' && !hostSettings.is_online) {
    throw new Error('This host just went offline. Please choose another host or book an upcoming slot.');
  }

  let finalPrice = Number(amount || hostSettings.rate_per_session || 99.0);

  if (slotId) {
    const { data: slot } = await db
      .from('phone_a_friend_slots')
      .select('status, price')
      .eq('id', slotId)
      .single();

    if (!slot || slot.status !== 'available') {
      throw new Error('This slot is already booked or no longer available.');
    }
    if (slot.price) {
      finalPrice = Number(slot.price);
    }
  }

  const receipt = `PAF_${Date.now().toString().slice(-8)}`;
  const order = await createRazorpayOrder({
    amount: Math.round(finalPrice * 100), // in paise
    currency: 'INR',
    receipt,
    notes: {
      call_type: callType,
      host_id: hostId,
      user_id: resolvedUserId,
      slot_id: slotId || '',
    },
  });

  return {
    success: true,
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: process.env.RAZORPAY_KEY_ID || '',
    receipt,
    rate: finalPrice,
  };
}

/**
 * User initiates an instant call or scheduled booking after payment.
 */
export async function initiateCall({
  userId,
  hostId,
  callType = 'instant',
  slotId = null,
  amount = 99.0,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
}: {
  userId: string;
  hostId: string;
  callType?: 'instant' | 'scheduled';
  slotId?: string | null;
  amount?: number;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
}) {
  const db = getDb();

  // Enforce mandatory payment verification
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw new Error('Payment required. Please complete payment before starting a call or booking a slot.');
  }

  const isPaymentValid = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
  if (!isPaymentValid) {
    throw new Error('Payment signature verification failed.');
  }

  // Resolve caller user ID to valid UUID and ensure record exists in users table
  const resolvedUserId = resolveCallerUuid(userId);
  await ensureCallerUserExists(db, resolvedUserId);

  // Verify host is enabled
  const { data: hostSettings } = await db
    .from('phone_a_friend_host_settings')
    .select('is_enabled, is_online, rate_per_session')
    .eq('host_id', hostId)
    .single();

  if (!hostSettings?.is_enabled) {
    throw new Error('This host is currently not available for calls.');
  }

  if (callType === 'instant' && !hostSettings.is_online) {
    throw new Error('This host just went offline. Please book a scheduled slot or choose another host.');
  }

  // If slotId provided, verify it is still available before inserting
  if (slotId) {
    const { data: slot } = await db
      .from('phone_a_friend_slots')
      .select('status')
      .eq('id', slotId)
      .single();

    if (slot?.status !== 'available') {
      throw new Error('This slot is no longer available.');
    }
  }

  // Unique call reference & agora channel name
  const callRef = `PAF-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const agoraChannelName = `paf_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

  const callStatus = callType === 'instant' ? 'ringing' : 'pending';

  const { data: call, error: callError } = await db
    .from('phone_a_friend_calls')
    .insert({
      call_ref: callRef,
      user_id: resolvedUserId,
      host_id: hostId,
      slot_id: slotId,
      call_type: callType,
      status: callStatus,
      payment_status: 'paid',
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      amount: amount || hostSettings.rate_per_session || 99.0,
      agora_channel_name: agoraChannelName,
    })
    .select(`
      *,
      host:host_profiles!host_id(id, display_name, profile_image),
      user:users!user_id(id, username, anonymous_alias, avatar_url)
    `)
    .single();

  if (callError) {
    console.error('[PhoneAFriendService] Error initiating call:', callError);
    throw new Error(callError.message);
  }

  // Slot is reserved only upon successful call insertion
  if (slotId) {
    await db
      .from('phone_a_friend_slots')
      .update({ status: 'booked', updated_at: new Date().toISOString() })
      .eq('id', slotId);
  }

  // Generate Agora token for User (using resolved user id as account)
  const userToken = generateVoiceToken({
    channelName: agoraChannelName,
    account: resolvedUserId,
  });

  return {
    call,
    agora: {
      appId: getAgoraAppId(),
      channelName: agoraChannelName,
      token: userToken.token,
      account: resolvedUserId,
    },
  };
}

/**
 * Host responds to an incoming call ('accept' or 'reject').
 */
export async function respondToCall({
  callId,
  hostId,
  action,
  actionType,
}: {
  callId: string;
  hostId: string;
  action?: 'accept' | 'reject';
  actionType?: 'accept' | 'reject';
}) {
  const db = getDb();
  const finalAction = action || actionType;

  if (!finalAction || !['accept', 'reject'].includes(finalAction)) {
    throw new Error(`Invalid response action: ${finalAction}`);
  }

  const { data: call, error } = await db
    .from('phone_a_friend_calls')
    .select('*')
    .eq('id', callId)
    .eq('host_id', hostId)
    .single();

  if (error || !call) {
    throw new Error('Call session not found.');
  }

  if (finalAction === 'reject') {
    const { data: updated, error: updateError } = await db
      .from('phone_a_friend_calls')
      .update({
        status: 'rejected',
        updated_at: new Date().toISOString(),
      })
      .eq('id', callId)
      .select()
      .single();

    if (updateError) throw new Error(updateError.message);
    return { success: true, call: updated };
  }

  // Accept call
  const now = new Date().toISOString();
  const { data: updatedCall, error: updateError } = await db
    .from('phone_a_friend_calls')
    .update({
      status: 'in_progress',
      actual_start_time: now,
      updated_at: now,
    })
    .eq('id', callId)
    .select(`
      *,
      user:users!user_id(id, username, anonymous_alias, avatar_url),
      host:host_profiles!host_id(id, display_name, profile_image)
    `)
    .single();

  if (updateError) throw new Error(updateError.message);

  // Generate Agora token for Host (using host id as account)
  const hostToken = generateVoiceToken({
    channelName: call.agora_channel_name,
    account: hostId,
  });

  return {
    success: true,
    call: updatedCall,
    agora: {
      appId: getAgoraAppId(),
      channelName: call.agora_channel_name,
      token: hostToken.token,
      account: hostId,
    },
  };
}

/**
 * Retrieves call session info and a fresh Agora token for an active participant.
 */
export async function getCallSessionToken({
  callId,
  requesterId,
}: {
  callId: string;
  requesterId: string;
}) {
  const db = getDb();

  const { data: call, error } = await db
    .from('phone_a_friend_calls')
    .select(`
      *,
      user:users!user_id(id, username, anonymous_alias, avatar_url),
      host:host_profiles!host_id(id, display_name, profile_image, user_id)
    `)
    .eq('id', callId)
    .single();

  if (error || !call) {
    throw new Error('Call session not found.');
  }

  const resolvedRequesterId = resolveCallerUuid(requesterId);
  const isUser = call.user_id === requesterId || call.user_id === resolvedRequesterId;
  const isHost = call.host_id === requesterId || (call.host as any)?.user_id === requesterId;

  if (!isUser && !isHost) {
    throw new Error('Unauthorized to join this call session.');
  }

  const account = isUser ? call.user_id : call.host_id;
  const voiceToken = generateVoiceToken({
    channelName: call.agora_channel_name,
    account,
  });

  return {
    call,
    isUser,
    isHost,
    agora: {
      appId: getAgoraAppId(),
      channelName: call.agora_channel_name,
      token: voiceToken.token,
      account,
    },
  };
}

/**
 * Terminates an active call session.
 */
export async function endCallSession({
  callId,
  requesterId,
}: {
  callId: string;
  requesterId: string;
}) {
  const db = getDb();

  const { data: call, error } = await db
    .from('phone_a_friend_calls')
    .select('*')
    .eq('id', callId)
    .single();

  if (error || !call) throw new Error('Call session not found.');

  const now = new Date();
  const startTime = call.actual_start_time ? new Date(call.actual_start_time) : now;
  const durationSeconds = Math.max(0, Math.round((now.getTime() - startTime.getTime()) / 1000));
  const durationMinutes = Math.ceil(durationSeconds / 60);

  const { data: updatedCall, error: updateErr } = await db
    .from('phone_a_friend_calls')
    .update({
      status: 'completed',
      actual_end_time: now.toISOString(),
      duration_seconds: durationSeconds,
      updated_at: now.toISOString(),
    })
    .eq('id', callId)
    .select()
    .single();

  if (updateErr) throw new Error(updateErr.message);

  // Update host stats
  if (call.host_id && durationMinutes > 0) {
    const { data: hostSettings } = await db
      .from('phone_a_friend_host_settings')
      .select('total_calls_completed, total_call_minutes')
      .eq('host_id', call.host_id)
      .maybeSingle();

    if (hostSettings) {
      await db
        .from('phone_a_friend_host_settings')
        .update({
          total_calls_completed: (hostSettings.total_calls_completed || 0) + 1,
          total_call_minutes: (hostSettings.total_call_minutes || 0) + durationMinutes,
          updated_at: now.toISOString(),
        })
        .eq('host_id', call.host_id);
    }
  }

  return { success: true, call: updatedCall };
}

/**
 * User submits rating and review for a completed call.
 */
export async function submitCallRating({
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
  const resolvedUserId = resolveCallerUuid(userId);

  const { data: call, error } = await db
    .from('phone_a_friend_calls')
    .update({
      user_rating: rating,
      user_review: review || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', callId)
    .eq('user_id', resolvedUserId)
    .select('host_id')
    .single();

  if (error || !call) throw new Error('Failed to record rating.');

  // Recalculate host average rating
  const { data: allRatings } = await db
    .from('phone_a_friend_calls')
    .select('user_rating')
    .eq('host_id', call.host_id)
    .not('user_rating', 'is', null);

  if (allRatings && allRatings.length > 0) {
    const avg = allRatings.reduce((acc, curr) => acc + (curr.user_rating || 0), 0) / allRatings.length;
    await db
      .from('phone_a_friend_host_settings')
      .update({
        rating_avg: Number(avg.toFixed(2)),
        rating_count: allRatings.length,
        updated_at: new Date().toISOString(),
      })
      .eq('host_id', call.host_id);
  }

  return { success: true };
}

/**
 * Admin: list all hosts with their Phone a Friend status.
 */
export async function adminGetCallingHosts() {
  const db = getDb();

  // Get all host profiles
  const { data: hosts, error } = await db
    .from('host_profiles')
    .select(`
      id,
      display_name,
      profile_image,
      city,
      is_approved,
      host_type,
      user:users!user_id(email),
      settings:phone_a_friend_host_settings(
        id,
        is_enabled,
        is_online,
        languages,
        topics,
        rate_per_session,
        session_duration_minutes,
        total_calls_completed,
        rating_avg
      )
    `)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return hosts || [];
}

/**
 * Admin: toggle host permission to offer Phone a Friend service.
 */
export async function adminToggleHostPermission(hostId: string, isEnabled: boolean) {
  return updateHostCallingSettings(hostId, { is_enabled: isEnabled });
}

/**
 * Admin: get recent call logs.
 */
export async function adminGetCallLogs(limit = 50) {
  const db = getDb();

  const { data, error } = await db
    .from('phone_a_friend_calls')
    .select(`
      *,
      user:users!user_id(id, username, anonymous_alias, email),
      host:host_profiles!host_id(id, display_name, profile_image)
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return data || [];
}
