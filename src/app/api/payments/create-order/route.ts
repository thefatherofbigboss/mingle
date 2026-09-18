import { NextRequest, NextResponse } from 'next/server';
import { getEventById } from '@/lib/events';
import { createServerClient, createAdminClient } from '@/lib/supabaseClient';
import { createRazorpayOrder } from '@/lib/razorpay';
import { processPaymentSuccess } from '@/lib/payment-utils';
import { adminAuth } from '@/lib/firebase-admin';
import { v5 as uuidv5 } from 'uuid';
import { SM_UUID_NAMESPACE } from '@/lib';

// Rate limiting for payment orders
const orderCache = new Map<string, number[]>();
const ORDER_RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const MAX_ORDERS_PER_IP = 20;

function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const orders = orderCache.get(ip) || [];
    const recentOrders = orders.filter(time => now - time < ORDER_RATE_LIMIT_WINDOW);

    if (recentOrders.length >= MAX_ORDERS_PER_IP) {
        return true;
    }

    recentOrders.push(now);
    orderCache.set(ip, recentOrders);
    return false;
}

function getClientIP(request: NextRequest): string {
    const forwarded = request.headers.get('x-forwarded-for');
    const realIP = request.headers.get('x-real-ip');
    return forwarded?.split(',')[0] || realIP || 'unknown';
}

function sanitize(str: string): string {
    if (!str) return '';
    return str.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').trim().substring(0, 200);
}

export async function POST(request: NextRequest) {
    try {
        const clientIP = getClientIP(request);
        if (isRateLimited(clientIP)) {
            return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
        }

        const body = await request.json();
        const { eventId, name, phone, email, tickets, promoCode } = body;

        // tickets should be an array of { tierId, quantity }
        if (!eventId || !name || !phone || !tickets || !Array.isArray(tickets) || tickets.length === 0) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const sanitizedName = sanitize(name);
        const sanitizedEmail = email ? email.toLowerCase().trim() : '';
        const cleanedPhone = phone.replace(/\D/g, '');

        // Get event details with tiers
        const event = await getEventById(eventId);
        if (!event) {
            return NextResponse.json({ error: 'Event not found' }, { status: 404 });
        }

        if (event.status !== 'published') {
            return NextResponse.json({ error: 'Event is not live' }, { status: 400 });
        }

        // Validate tickets against event tiers
        let totalAmount = 0;
        const bookingItems = [];

        for (const item of tickets) {
            const tier = event.ticket_tiers?.find(t => t.id === item.tierId);
            if (!tier || !tier.is_active) {
                return NextResponse.json({ error: `Invalid ticket tier: ${item.tierId}` }, { status: 400 });
            }

            if (item.quantity > tier.max_per_booking) {
                return NextResponse.json({ error: `Maximum ${tier.max_per_booking} tickets allowed for ${tier.name}` }, { status: 400 });
            }

            const remaining = tier.total_quantity - tier.sold_count;
            if (item.quantity > remaining) {
                return NextResponse.json({ error: `Only ${remaining} tickets left for ${tier.name}` }, { status: 400 });
            }

            const subtotal = tier.price * item.quantity;
            totalAmount += subtotal;
            bookingItems.push({
                ticket_tier_id: tier.id,
                quantity: item.quantity,
                unit_price: tier.price,
                subtotal: subtotal,
            });
        }

        const supabase = createServerClient();
        const adminClient = createAdminClient();

        // --- PROMO CODE VALIDATION ---
        let discountAmount = 0;
        let finalAmount = totalAmount;
        let appliedPromoId = null;

        if (promoCode && totalAmount > 0) {
            const { data: promo, error: promoError } = await adminClient
                .from('promo_codes')
                .select('*')
                .eq('code', promoCode.trim().toUpperCase())
                .single();

            if (!promoError && promo) {
                const now = new Date();
                const isValidEvent = promo.event_id === eventId;
                const isActive = promo.is_active;
                const isValidFrom = !promo.valid_from || new Date(promo.valid_from) <= now;
                const isValidUntil = !promo.valid_until || new Date(promo.valid_until) >= now;
                const isWithinLimits = promo.max_uses === null || (promo.used_count || 0) < promo.max_uses;

                if (isValidEvent && isActive && isValidFrom && isValidUntil && isWithinLimits) {
                    if (promo.discount_type === 'percentage') {
                        discountAmount = (totalAmount * promo.discount_value) / 100;
                    } else if (promo.discount_type === 'fixed_amount') {
                        discountAmount = promo.discount_value;
                    }

                    if (discountAmount > totalAmount) {
                        discountAmount = totalAmount;
                    }
                    
                    finalAmount = Math.max(0, totalAmount - discountAmount);
                    appliedPromoId = promo.id;
                }
            }
        }
        // --- END PROMO CODE VALIDATION ---

        const { data: { user: authUser } } = await supabase.auth.getUser();
        let userId = authUser?.id || null;

        const bearerHeader = request.headers.get('Authorization');
        if (!userId && bearerHeader && bearerHeader.startsWith('Bearer ')) {
            const idToken = bearerHeader.split('Bearer ')[1];
            try {
                const decodedToken = await adminAuth.verifyIdToken(idToken);
                userId = uuidv5(decodedToken.uid, SM_UUID_NAMESPACE);
                console.log(`[Checkout] Authenticated via Firebase token. UserID: ${userId}`);
            } catch (e: any) {
                console.warn('[Checkout] Firebase token verification failed:', e.message);
            }
        }

        // NEW LOGIC: If guest, find or create user profile to fix 500 error (user_id is mandatory)
        if (!userId && sanitizedEmail) {
            console.log(`Processing guest checkout for email: ${sanitizedEmail}`);
            try {
                // 1. Check if user already exists in public.users
                const { data: existingUser, error: _searchError } = await adminClient
                    .from('users')
                    .select('id')
                    .eq('email', sanitizedEmail)
                    .maybeSingle();

                if (existingUser) {
                    userId = existingUser.id;
                    console.log(`Associated guest booking with existing public.users record: ${userId}`);
                } else {
                    // Create NEW guest account or find if exists in Auth but not in public.users
                    console.log(`Attempting to create/find Auth user for guest...`);
                    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
                        email: sanitizedEmail,
                        phone: cleanedPhone || undefined,
                        password: Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10),
                        email_confirm: true,
                        user_metadata: { 
                            full_name: sanitizedName,
                            source: 'guest_checkout'
                        }
                    });

                    if (newUser?.user) {
                        userId = newUser.user.id;
                        console.log(`Created new guest user in Auth: ${userId}`);
                    } else if (createError?.status === 422 || createError?.message?.toLowerCase().includes('already been registered')) {
                        // User exists in Auth but not in public.users
                        console.log(`Auth user already exists for ${sanitizedEmail}, fetching ID via RPC...`);
                        
                        const { data: rpcUserId, error: rpcError } = await adminClient.rpc('get_user_id_by_email', { p_email: sanitizedEmail });
                        
                        if (rpcError) {
                            console.error('Error calling get_user_id_by_email RPC:', rpcError);
                        } else if (rpcUserId) {
                            userId = rpcUserId;
                            console.log(`Established userId via RPC: ${userId}`);
                        } else {
                            console.error('RPC returned no userId for existing email. This is highly unexpected.');
                        }
                    } else {
                        console.error('Unexpected error during guest user creation in Auth:', createError);
                        // Don't throw here, let it try to proceed (though it will likely fail later if userId is null)
                    }

                    if (userId) {
                        // Manual insert into public.users to ensure profile exists
                        console.log(`Syncing profile for userId ${userId} into public.users...`);
                        const { data: _profile, error: profileError } = await adminClient.from('users').upsert({
                            id: userId,
                            email: sanitizedEmail,
                            phone: cleanedPhone || null,
                            username: sanitizedName.toLowerCase().replace(/\s/g, '_') + '_' + Math.floor(1000 + Math.random() * 9000),
                            anonymous_alias: 'stranger_' + Math.random().toString(36).slice(-8),
                            role: 'member',
                            is_active: true,
                            is_verified: false
                        }, { onConflict: 'id' });
                        
                        if (profileError) {
                            console.error('Manual profile upsert error:', profileError);
                        } else {
                        }
                    }
                }
            } catch (guestError) {
                console.error('CRITICAL: Guest checkout user sync exception:', guestError);
            }
        }

        if (!userId) {
            console.warn('WARNING: No userId could be established for booking. If bookings.user_id is non-nullable, this will fail.');
        }

        // Handle Free Booking
        if (finalAmount === 0) {
            const itemsForRpc = bookingItems.map(item => ({
                tierId: item.ticket_tier_id,
                quantity: item.quantity,
                unitPrice: item.unit_price,
                subtotal: item.subtotal
            }));

            const { data: bookingId, error: rpcError } = await supabase.rpc('create_pending_booking_v2', {
                p_event_id: eventId,
                p_user_id: userId,
                p_attendee_name: sanitizedName,
                p_attendee_email: sanitizedEmail,
                p_attendee_phone: cleanedPhone || null,
                p_total_amount: finalAmount,
                p_subtotal: totalAmount,
                p_discount_amount: discountAmount,
                p_razorpay_order_id: null,
                p_items: itemsForRpc
            });

            if (rpcError || !bookingId) {
                console.error('Failed to create free booking via RPC:', rpcError);
                return NextResponse.json({ error: rpcError?.message || 'Failed to create booking' }, { status: 400 });
            }

            // Update promo code if applied
            if (appliedPromoId) {
                await adminClient.from('bookings').update({ promo_code_id: appliedPromoId }).eq('id', bookingId);
                // The used_count should ideally be incremented inside confirm_booking_payment_v2, 
                // but since free booking is confirmed immediately, we can increment it here or rely on processPaymentSuccess.
                // Let's increment it here for safety.
                const { error: rpcIncErr } = await adminClient.rpc('increment_promo_code_usage', { p_promo_id: appliedPromoId });
                if (rpcIncErr) {
                    console.error('RPC failed, falling back to basic increment:', rpcIncErr);
                    const { data: currentPromo } = await adminClient.from('promo_codes').select('used_count').eq('id', appliedPromoId).single();
                    if (currentPromo) {
                        await adminClient.from('promo_codes').update({ used_count: (currentPromo.used_count || 0) + 1 }).eq('id', appliedPromoId);
                    }
                }
            }

            // Process free booking success (confirm and send email)
            const result = await processPaymentSuccess({
                bookingId: bookingId,
                razorpayPaymentId: 'FREE_BOOKING',
                razorpaySignature: 'FREE',
                razorpayMethod: 'free',
            });

            if (!result.success) {
                console.error('Free booking confirmation failed via processPaymentSuccess:', result.error);
                
                // Fallback: Manually update status if the combined process failed 
                // but we still want to give the user a good experience if possible
                const adminClient = createAdminClient();
                await adminClient
                    .from('bookings')
                    .update({ 
                        status: 'confirmed', 
                        payment_status: 'paid',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', bookingId);
            }

            return NextResponse.json({ isFree: true, bookingId: bookingId });
        }

        // Create Razorpay Order
        const razorpayOrder = await createRazorpayOrder({
            amount: Math.round(finalAmount * 100), // Convert to paise
            currency: 'INR',
            receipt: `receipt_${Date.now()}`,
            notes: {
                eventId: eventId,
                attendeeName: sanitizedName,
            },
        });

        // Create Pending Booking securely with new atomic DB RPC
        const itemsForRpc = bookingItems.map(item => ({
            tierId: item.ticket_tier_id,
            quantity: item.quantity,
            unitPrice: item.unit_price,
            subtotal: item.subtotal
        }));

        const { data: bookingId, error: rpcError } = await supabase.rpc('create_pending_booking_v2', {
            p_event_id: eventId,
            p_user_id: userId,
            p_attendee_name: sanitizedName,
            p_attendee_email: sanitizedEmail,
            p_attendee_phone: cleanedPhone || null,
            p_total_amount: finalAmount,
            p_subtotal: totalAmount,
            p_discount_amount: discountAmount,
            p_razorpay_order_id: razorpayOrder.id,
            p_items: itemsForRpc
        });

        if (rpcError || !bookingId) {
            console.error('Failed to create booking via RPC:', rpcError);
            return NextResponse.json({ error: rpcError?.message || 'Failed to create booking' }, { status: 400 });
        }

        // Update promo code if applied
        if (appliedPromoId) {
            await adminClient.from('bookings').update({ promo_code_id: appliedPromoId }).eq('id', bookingId);
        }

        return NextResponse.json({
            razorpayOrderId: razorpayOrder.id,
            amount: razorpayOrder.amount,
            currency: 'INR',
            bookingId: bookingId,
            keyId: process.env.RAZORPAY_KEY_ID,
        });

    } catch (error: unknown) {
        console.error('CRITICAL: Error in create-order API:', error);
        return NextResponse.json({ 
            error: error instanceof Error ? error.message : 'Internal server error',
            details: error instanceof Error ? error.stack : undefined
        }, { status: 500 });
    }
}
