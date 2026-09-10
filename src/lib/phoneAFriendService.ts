import { createAdminClient } from './supabaseClient';
import { generateVoiceToken, getAgoraAppId, isAgoraConfigured } from './agoraService';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { SM_UUID_NAMESPACE, findOrCreateUserByContact } from './userProfile';
import { createRazorpayOrder, verifyRazorpaySignature } from './razorpay';
import { sendEmail, generateMembershipVerificationHtml } from './email';
import { generatePhoneAFriendTicketPdf } from './ticket-generator';

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
  durationMinutes = 15,
  callerName,
  callerEmail,
  callerPhone,
  deviceFingerprint,
  ip,
  userAgent,
}: {
  userId: string;
  hostId: string;
  callType?: 'instant' | 'scheduled';
  slotId?: string | null;
  amount?: number;
  durationMinutes?: number;
  callerName?: string;
  callerEmail?: string;
  callerPhone?: string;
  deviceFingerprint?: string;
  ip?: string;
  userAgent?: string;
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

  const baseRate = Number(hostSettings.rate_per_session || 49.0);
  const dur = Number(durationMinutes) || 15;
  const units = Math.max(1, Math.round(dur / 15));
  let finalPrice = baseRate * units;

  if (amount) {
    finalPrice = Number(amount);
  }

  if (slotId) {
    const { data: slot } = await db
      .from('phone_a_friend_slots')
      .select('status, price')
      .eq('id', slotId)
      .single();

    if (!slot || slot.status !== 'available') {
      throw new Error('This slot is already booked or no longer available.');
    }
    if (slot.price && !amount) {
      finalPrice = Number(slot.price);
    }
  }

  // Count repeat calls from this device fingerprint silently
  let repeatCount = 0;
  if (deviceFingerprint) {
    try {
      const { count } = await db
        .from('phone_a_friend_telemetry')
        .select('*', { count: 'exact', head: true })
        .eq('device_fingerprint', deviceFingerprint);
      repeatCount = count || 0;
    } catch (e) {
      console.warn('[PhoneAFriendService] Telemetry lookup warning:', e);
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
      duration_minutes: String(dur),
      repeat_device_calls: String(repeatCount),
      caller_email: callerEmail || '',
      caller_phone: callerPhone || '',
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
    durationMinutes: dur,
    repeatCallCount: repeatCount,
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
  amount = 49.0,
  durationMinutes = 15,
  callerName,
  callerEmail,
  callerPhone,
  deviceFingerprint,
  ip,
  userAgent,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  paymentMethod = 'razorpay',
}: {
  userId: string;
  hostId: string;
  callType?: 'instant' | 'scheduled';
  slotId?: string | null;
  amount?: number;
  durationMinutes?: number;
  callerName?: string;
  callerEmail?: string;
  callerPhone?: string;
  deviceFingerprint?: string;
  ip?: string;
  userAgent?: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  paymentMethod?: 'razorpay' | 'credits';
}) {
  const db = getDb();

  // Provision / link user in public.users first so we can verify credits or link payment
  let resolvedUserId = resolveCallerUuid(userId);
  if (callerEmail) {
    try {
      const syncedId = await findOrCreateUserByContact({
        email: callerEmail,
        phone: callerPhone,
        name: callerName,
      });
      if (syncedId) resolvedUserId = syncedId;
    } catch (provisionErr) {
      console.error('[PhoneAFriendService] User sync warning:', provisionErr);
      await ensureCallerUserExists(db, resolvedUserId);
    }
  } else {
    await ensureCallerUserExists(db, resolvedUserId);
  }

  // Verify host is enabled
  const { data: hostSettings } = await db
    .from('phone_a_friend_host_settings')
    .select('is_enabled, is_online, rate_per_session')
    .eq('host_id', hostId)
    .single();

  if (!hostSettings?.is_enabled) {
    throw new Error('This host is currently not available for calls.');
  }

  const dur = Number(durationMinutes) || 15;
  const finalAmount = amount || (Number(hostSettings?.rate_per_session || 49.0) * Math.max(1, Math.round(dur / 15)));
  const creditsNeeded = Math.round(Number(finalAmount) * 10);

  let effectiveOrderId = razorpayOrderId;
  let effectivePaymentId = razorpayPaymentId;

  if (paymentMethod === 'credits') {
    // Validate user's available credits
    const { data: userRow } = await db
      .from('users')
      .select('credits')
      .eq('id', resolvedUserId)
      .maybeSingle();

    const currentCredits = userRow?.credits || 0;
    if (currentCredits < creditsNeeded) {
      throw new Error(`Insufficient credits. This session requires ${creditsNeeded} credits, but you currently have ${currentCredits} credits.`);
    }

    // Deduct credits from user
    const remainingCredits = currentCredits - creditsNeeded;
    await db
      .from('users')
      .update({
        credits: remainingCredits,
        updated_at: new Date().toISOString(),
      })
      .eq('id', resolvedUserId);

    console.log(`[PhoneAFriendService] Deducted ${creditsNeeded} credits from user ${resolvedUserId}. Remaining: ${remainingCredits}`);

    effectiveOrderId = razorpayOrderId || 'CREDITS';
    effectivePaymentId = razorpayPaymentId || `CREDITS_${Date.now()}`;
  } else {
    // Enforce mandatory Razorpay payment verification
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      throw new Error('Payment required. Please complete payment before starting a call or booking a slot.');
    }

    const isPaymentValid = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
    if (!isPaymentValid) {
      throw new Error('Payment signature verification failed.');
    }
  }

  // If instant call, check if host is currently online.
  // Note: We do NOT throw here if offline, because payment was already verified; we record the call and award credits.
  const isHostOnline = !!hostSettings?.is_online;
  const callStatus = callType === 'instant' ? (isHostOnline ? 'ringing' : 'unanswered') : 'pending';

  // Check how many times this physical device has called us across any email/phone
  let deviceCallCount = 1;
  if (deviceFingerprint) {
    try {
      const { count } = await db
        .from('phone_a_friend_telemetry')
        .select('*', { count: 'exact', head: true })
        .eq('device_fingerprint', deviceFingerprint);
      deviceCallCount = (count || 0) + 1;
    } catch (e) {
      console.warn('[PhoneAFriendService] Device count query warning:', e);
    }
  }

  // Unique call reference & agora channel name
  const callRef = `PAF-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const agoraChannelName = `paf_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

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
      razorpay_order_id: effectiveOrderId,
      razorpay_payment_id: effectivePaymentId,
      amount: finalAmount,
      duration_minutes: dur,
      ip_address: ip || null,
      device_fingerprint: deviceFingerprint || null,
      device_call_count: deviceCallCount,
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

  // 1. Dispatch high-priority Web Push notification to wake up host mobile device (even if screen is off)
  if (callStatus === 'ringing') {
    try {
      const { sendCallPushNotification } = await import('./pushService');
      const callerNameForPush = callerName || call.user?.username || call.user?.anonymous_alias || 'A Member';
      sendCallPushNotification(hostId, {
        callId: call.id,
        callRef: call.call_ref,
        callerName: callerNameForPush,
        amount: finalAmount,
        durationMinutes: dur,
      }).catch((pushErr) => console.error('[PhoneAFriendService] Background push dispatch error:', pushErr));
    } catch (importErr) {
      console.warn('[PhoneAFriendService] Push service import failed:', importErr);
    }
  }

  // 2. Credit Conversion: 1 INR = 10 credits (Only for direct payments, not credit redemptions)
  let creditsEarned = 0;
  if (paymentMethod !== 'credits') {
    creditsEarned = Math.round(Number(finalAmount) * 10);
    if (resolvedUserId && creditsEarned > 0) {
      try {
        const { data: userRow } = await db
          .from('users')
          .select('credits')
          .eq('id', resolvedUserId)
          .maybeSingle();

        const newCredits = (userRow?.credits || 0) + creditsEarned;
        await db
          .from('users')
          .update({
            credits: newCredits,
            updated_at: new Date().toISOString(),
          })
          .eq('id', resolvedUserId);

        console.log(`[PhoneAFriendService] Credited ${creditsEarned} credits to user ${resolvedUserId}. New total: ${newCredits}`);
      } catch (creditErr) {
        console.error('[PhoneAFriendService] Credit award error:', creditErr);
      }
    }
  }

  // Record Telemetry in public.phone_a_friend_telemetry silently
  try {
    await db.from('phone_a_friend_telemetry').insert({
      call_id: call.id,
      user_id: resolvedUserId,
      ip_address: ip || null,
      device_fingerprint: deviceFingerprint || 'unknown',
      user_agent: userAgent || null,
      caller_name: callerName || null,
      caller_email: callerEmail || null,
      caller_phone: callerPhone || null,
      client_metadata: {
        device_call_count: deviceCallCount,
        call_ref: callRef,
        duration_minutes: dur,
        credits_awarded: creditsEarned,
      },
    });
  } catch (telemErr) {
    console.warn('[PhoneAFriendService] Telemetry insert warning:', telemErr);
  }

  // Slot is reserved only upon successful call insertion
  if (slotId) {
    await db
      .from('phone_a_friend_slots')
      .update({ status: 'booked', updated_at: new Date().toISOString() })
      .eq('id', slotId);
  }

  // Check / Provision Membership & Dispatch Custom Email
  if (callerEmail) {
    const normalizedEmail = callerEmail.trim().toLowerCase();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://strangermingle.com';

    let isExistingMember = false;
    let verificationToken: string | null = null;

    try {
      const { data: existingSub } = await db
        .from('user_subscriptions')
        .select('id, status, is_verified')
        .or(`user_id.eq.${resolvedUserId},customer_email.eq.${normalizedEmail}`)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

      if (existingSub) {
        isExistingMember = true;
      } else {
        // Create 1-month membership with 1-month trial
        verificationToken = uuidv4();
        const now = new Date();
        const currentStart = now.toISOString();
        const currentEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

        await db.from('user_subscriptions').insert({
          user_id: resolvedUserId,
          customer_name: callerName || 'Community Friend',
          customer_email: normalizedEmail,
          customer_phone: callerPhone || null,
          status: 'active',
          is_verified: false,
          verification_token: verificationToken,
          plan_type: 'monthly',
          current_period_start: currentStart,
          current_period_end: currentEnd,
          notes: {
            free_trial: true,
            source: 'phone_a_friend',
            call_ref: callRef,
            credits_awarded: creditsEarned,
          },
        });
        console.log(`[PhoneAFriendService] Created 1-month trial subscription for ${normalizedEmail}`);
      }
    } catch (membershipErr) {
      console.error('[PhoneAFriendService] Membership check/grant error:', membershipErr);
    }

    // Generate & Send PDF Call Ticket + Tailored Email
    try {
      const pdfBytes = await generatePhoneAFriendTicketPdf({
        callRef,
        callerName: callerName || 'Valued Caller',
        callerEmail: callerEmail,
        callerPhone: callerPhone,
        hostName: call.host?.display_name || 'Community Host',
        callType,
        durationMinutes: dur,
        amountPaid: Number(call.amount) || finalAmount,
        scheduledTime: call.scheduled_start_time,
        createdAt: call.created_at,
      });

      const dashboardLink = `${appUrl}/members`;
      const verificationLink = verificationToken ? `${appUrl}/verify-membership?token=${verificationToken}` : dashboardLink;

      const isPaidWithCredits = paymentMethod === 'credits';

      const emailSubject = isPaidWithCredits
        ? `Call Pass Confirmed: [${callRef}] (${creditsNeeded} Credits Redeemed)`
        : isExistingMember
          ? `Payment Confirmed: Your Call Pass [${callRef}] & ${creditsEarned} Credits Added`
          : `Payment Confirmed [${callRef}] + Activate Your 1-Month Free Membership (${creditsEarned} Credits)`;

      const ctaButtonHtml = (isExistingMember || isPaidWithCredits)
        ? `
          <div style="text-align: center; margin: 28px 0;">
            <a href="${dashboardLink}" style="background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: bold; font-size: 15px; display: inline-block; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);">
              Open Member Dashboard →
            </a>
            <p style="font-size: 12px; color: #6b7280; margin-top: 8px;">View your active membership status and credit balance.</p>
          </div>
        `
        : `
          <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 16px; padding: 20px; margin: 24px 0; text-align: center;">
            <div style="font-size: 16px; font-weight: 700; color: #166534; margin-bottom: 6px;">🎁 Bonus: 1-Month Free Premium Membership!</div>
            <p style="font-size: 13px; color: #15803d; margin: 0 0 16px 0;">
              Because you called a friend, you have unlocked 1 month of complimentary access to Stranger Mingle along with <strong>${creditsEarned} credits</strong>.
            </p>
            <a href="${verificationLink}" style="background: linear-gradient(135deg, #16a34a, #15803d); color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: bold; font-size: 15px; display: inline-block; box-shadow: 0 4px 12px rgba(22, 163, 74, 0.25);">
              Verify Email & Activate Free Month →
            </a>
          </div>
        `;

      await sendEmail({
        to: normalizedEmail,
        subject: emailSubject,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; color: #1f2937; max-width: 600px; margin: auto; border: 1px solid #f3f4f6; border-radius: 16px; background-color: #ffffff;">
            <div style="border-bottom: 2px solid #f43f5e; padding-bottom: 12px; margin-bottom: 20px;">
              <h1 style="color: #f43f5e; margin: 0; font-size: 22px;">Stranger Mingle</h1>
              <p style="margin: 4px 0 0 0; color: #6b7280; font-size: 13px;">Phone a Friend - 1-on-1 Confidential Voice Call</p>
            </div>
            <p style="font-size: 15px; line-height: 1.5;">Hello <strong>${callerName || 'Friend'}</strong>,</p>
            <p style="font-size: 14px; line-height: 1.5; color: #4b5563;">
              ${
                isPaidWithCredits
                  ? `Your call pass has been confirmed using <strong>${creditsNeeded} Membership Credits</strong>.`
                  : `Your payment of <strong>INR ${call.amount}/-</strong> has been confirmed. We have credited <strong>🪙 ${creditsEarned} Credits</strong> (1 INR = 10 Credits) to your account.`
              }
            </p>

            <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; background: #f9fafb; border-radius: 12px; overflow: hidden;">
              <tr><td style="padding: 10px 14px; color: #6b7280; border-bottom: 1px solid #e5e7eb;">Call Reference:</td><td style="padding: 10px 14px; font-weight: bold; color: #f43f5e; border-bottom: 1px solid #e5e7eb;">${callRef}</td></tr>
              <tr><td style="padding: 10px 14px; color: #6b7280; border-bottom: 1px solid #e5e7eb;">Assigned Host:</td><td style="padding: 10px 14px; font-weight: bold; border-bottom: 1px solid #e5e7eb;">${call.host?.display_name || 'Host'}</td></tr>
              <tr><td style="padding: 10px 14px; color: #6b7280; border-bottom: 1px solid #e5e7eb;">Session Duration:</td><td style="padding: 10px 14px; font-weight: bold; border-bottom: 1px solid #e5e7eb;">${dur} Minutes</td></tr>
              ${
                isPaidWithCredits
                  ? `<tr><td style="padding: 10px 14px; color: #6b7280; border-bottom: 1px solid #e5e7eb;">Credits Redeemed:</td><td style="padding: 10px 14px; font-weight: bold; color: #f43f5e; border-bottom: 1px solid #e5e7eb;">-${creditsNeeded} Credits</td></tr>
                     <tr><td style="padding: 10px 14px; color: #6b7280;">Payment Method:</td><td style="padding: 10px 14px; font-weight: bold;">Membership Credits</td></tr>`
                  : `<tr><td style="padding: 10px 14px; color: #6b7280; border-bottom: 1px solid #e5e7eb;">Credits Added:</td><td style="padding: 10px 14px; font-weight: bold; color: #059669; border-bottom: 1px solid #e5e7eb;">+${creditsEarned} Credits</td></tr>
                     <tr><td style="padding: 10px 14px; color: #6b7280;">Amount Paid:</td><td style="padding: 10px 14px; font-weight: bold;">INR ${call.amount}/-</td></tr>`
              }
            </table>

            ${ctaButtonHtml}

            <p style="font-size: 13px; color: #6b7280;">📎 Your official <strong>PDF Call Pass</strong> is attached to this email for your records.</p>
            <div style="background-color: #fff1f2; border-left: 4px solid #f43f5e; padding: 12px; border-radius: 8px; margin-top: 20px; font-size: 12px; color: #9f1239;">
              <strong>Safety Reminder:</strong> 100% Anonymous voice calls. Exchanging personal phone numbers, WhatsApp, or financial details is strictly prohibited.
            </div>
          </div>
        `,
        attachments: [
          {
            filename: `ticket-${callRef}.pdf`,
            content: Buffer.from(pdfBytes),
          },
        ],
      });
      console.log(`[PhoneAFriendService] Dispatched confirmation email to ${normalizedEmail}`);
    } catch (ticketMailErr) {
      console.error('[PhoneAFriendService] Ticket mailing warning:', ticketMailErr);
    }
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
 * Host submits rating and private notes for the caller.
 * Note: Never exposed to the caller. Only visible to hosts on incoming calls / host dashboard.
 */
export async function submitHostCallerReview({
  callId,
  hostId,
  rating,
  notes,
}: {
  callId: string;
  hostId: string;
  rating: number;
  notes?: string;
}) {
  const db = getDb();
  const safeRating = Math.max(1, Math.min(5, Math.round(Number(rating) || 5)));

  const { data: updatedCall, error } = await db
    .from('phone_a_friend_calls')
    .update({
      host_caller_rating: safeRating,
      host_notes: notes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', callId)
    .eq('host_id', hostId)
    .select('id, host_caller_rating, host_notes')
    .single();

  if (error || !updatedCall) {
    console.error('[PhoneAFriendService] Error submitting caller review by host:', error);
    throw new Error('Failed to record host review for caller.');
  }

  return { success: true, call: updatedCall };
}

/**
 * Fetch caller's historical reputation for the host (average rating and previous notes).
 * Strictly used by host incoming alert and host interfaces.
 */
export async function getCallerReputationForHost(callerUserId: string) {
  const db = getDb();
  const resolvedUserId = resolveCallerUuid(callerUserId);

  const { data: calls, error } = await db
    .from('phone_a_friend_calls')
    .select('id, host_caller_rating, host_notes, created_at')
    .eq('user_id', resolvedUserId);

  if (error || !calls || calls.length === 0) {
    return {
      totalCalls: 0,
      averageRating: null,
      ratingCount: 0,
      recentNotes: [],
    };
  }

  const ratedCalls = calls.filter(
    (c) => typeof c.host_caller_rating === 'number' && c.host_caller_rating > 0
  );
  const totalCalls = calls.length;
  const ratingCount = ratedCalls.length;
  const averageRating =
    ratingCount > 0
      ? Number(
          (
            ratedCalls.reduce((acc, c) => acc + c.host_caller_rating!, 0) / ratingCount
          ).toFixed(1)
        )
      : null;

  const recentNotes = calls
    .filter((c) => c.host_notes && c.host_notes.trim().length > 0)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 3)
    .map((c) => c.host_notes!.trim());

  return {
    totalCalls,
    averageRating,
    ratingCount,
    recentNotes,
  };
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
