import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { createAdminClient } from './supabaseClient';

// Deterministic UUID Namespace for Stranger Mingle (using standard DNS namespace)
export const SM_UUID_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

/**
 * User record in public.users table
 */
export interface UserRecord {
    id: string; // The UUID (from deterministic conversion of Firebase UID)
    username?: string | null;
    email?: string | null;
    phone?: string | null;
    role?: 'member' | 'admin' | 'guest';
    avatar_url?: string | null;
    created_at?: string;
    updated_at?: string;
}

/**
 * Automatic Sync between Firebase Identity and Supabase Database
 * This ensures that a user record exists in 'public.users' 
 * so that foreign keys and RLS work correctly.
 */
/**
 * Automatic Sync between Firebase Identity and Supabase Database
 * This ensures that a user record exists in 'public.users' 
 * and handles merging if a 'pre-signup' record was created during payment.
 */
export async function syncFirebaseUser(firebaseUser: { 
    uid: string; 
    email?: string; 
    displayName?: string; 
    phoneNumber?: string; 
    mappedUserId: string; 
    provider?: string; // 'google.com', 'phone', 'password', etc.
} | any): Promise<UserRecord | null> {
    const supabase = createAdminClient();
    const { mappedUserId, uid, email, displayName, phoneNumber } = firebaseUser;

    // 1. Check by ID (Canonical)
    const { data: userById } = await supabase
        .from('users')
        .select('*')
        .eq('id', mappedUserId)
        .maybeSingle();

    if (userById) {
        // SELF-HEALING: If phone is missing from profile but present in Firebase, or if we can find it in an active subscription
        let finalPhone = phoneNumber || userById.phone;
        
        if (!finalPhone) {
            const { data: sub } = await supabase
                .from('user_subscriptions')
                .select('customer_phone')
                .eq('user_id', mappedUserId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            
            if (sub?.customer_phone) {
                console.log(`[UserService] Self-healed phone from subscription: ${sub.customer_phone}`);
                finalPhone = sub.customer_phone;
            }
        }

        const { error: updateError } = await supabase.from('users').update({
            email: email || userById.email,
            phone: finalPhone,
            updated_at: new Date().toISOString()
        }).eq('id', mappedUserId);
        
        await linkSubscriptionToUser(mappedUserId, email || '', phoneNumber || '');
        
        // Ensure OAuth link is present
        await syncOAuthAccount(mappedUserId, firebaseUser);

        return userById;
    }

    // 2. Check by Email/Phone (Potential Pre-signup record)
    if (email || phoneNumber) {
        const query = supabase.from('users').select('*');
        if (email && phoneNumber) {
            query.or(`email.eq.${email},phone.eq.${phoneNumber}`);
        } else if (email) {
            query.eq('email', email);
        } else {
            query.eq('phone', phoneNumber);
        }

        const { data: userByContact } = await query.maybeSingle();

        if (userByContact) {
            console.log(`[UserService] Migrating skeleton ID ${userByContact.id} -> Canonical ID ${mappedUserId}`);
            
            // 1. Attempt to migrate the user ID to the canonical one (Deterministic UUID)
            const { data: migratedUser, error: migrationError } = await supabase
                .from('users')
                .update({
                    id: mappedUserId, // IDENTITY MIGRATION
                    username: displayName || userByContact.username,
                    updated_at: new Date().toISOString()
                })
                .eq('id', userByContact.id)
                .select()
                .single();

            if (migrationError) {
                console.warn('[UserService] Identity migration failed (likely FK constraints). Updating metadata only.', migrationError.message);
                
                // Fallback: Update metadata without ID change if migration is blocked
                const { data: updatedUser } = await supabase
                    .from('users')
                    .update({
                        username: displayName || userByContact.username,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', userByContact.id)
                    .select()
                    .single();

                if (updatedUser) {
                    await linkSubscriptionToUser(userByContact.id, email || '', phoneNumber || '');
                    return updatedUser;
                }
                return userByContact;
            }

            if (migratedUser) {
                // 2. Update dependent records to point to the new Canonical ID
                // This handles mapping for newly linked subscriptions and payments
                await supabase.from('user_subscriptions')
                    .update({ user_id: mappedUserId })
                    .eq('user_id', userByContact.id);

                await linkSubscriptionToUser(mappedUserId, email || '', phoneNumber || '');
                
                // Ensure OAuth link is present
                await syncOAuthAccount(mappedUserId, firebaseUser);

                return migratedUser;
            }
        }
    }

    // 3. Fallback: Create new record for the user
    console.log(`[UserService] Provisioning new user record for ${uid} -> ${mappedUserId}`);
    const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert({
            id: mappedUserId,
            username: displayName || email?.split('@')[0] || `user_${uid.slice(0, 5)}`,
            email: email || null,
            phone: phoneNumber || null,
            role: 'member',
            updated_at: new Date().toISOString()
        })
        .select()
        .single();

    if (insertError) {
        console.error('[UserService] Error creating user record:', insertError);
        return null;
    }

    await linkSubscriptionToUser(mappedUserId, email || '', phoneNumber || '');
    
    // 4. Sync OAuth Account Link
    await syncOAuthAccount(mappedUserId, firebaseUser);

    return newUser;
}

/**
 * Syncs the OAuth link in user_oauth_accounts
 * This ensures we have a record of the external identity (Firebase UID)
 * mapped to our internal Supabase User ID.
 */
async function syncOAuthAccount(userId: string, firebaseUser: any) {
    const supabase = createAdminClient();
    const provider = firebaseUser.provider || 'firebase';
    const providerUid = firebaseUser.uid;

    if (!providerUid) return;

    const { error } = await supabase
        .from('user_oauth_accounts')
        .upsert({
            user_id: userId,
            provider: provider,
            provider_uid: providerUid,
        }, { onConflict: 'provider,provider_uid' });

    if (error) {
        // We log but don't fail, as this is a secondary identity link
        console.warn('[UserService] OAuth link sync failed:', error.message);
    } else {
        console.log(`[UserService] OAuth identity linked: ${provider}:${providerUid} -> ${userId}`);
    }
}

/**
 * Finds a user by contact or creates a 'Pending' record.
 * Used primarily during Payment Verification when the user might not have a Firebase account yet.
 */
export async function findOrCreateUserByContact(data: {
    email: string;
    phone?: string;
    name?: string;
}): Promise<string | null> {
    const supabase = createAdminClient();
    const { email, phone, name } = data;

    // 1. Try to find existing
    const query = supabase.from('users').select('id');
    const conditions = [];
    if (email) conditions.push(`email.eq.${email}`);
    if (phone) conditions.push(`phone.eq.${phone}`);
    
    const { data: existing } = await query.or(conditions.join(',')).maybeSingle();
    if (existing) {
        return existing.id;
    }

    // 2. Create new skeleton record
    console.log(`[UserService] Creating skeleton record for new customer: ${email}`);
    const { data: created, error } = await supabase
        .from('users')
        .insert({
            id: uuidv4(), // Standard V4 UUID
            email: email,
            phone: phone || null,
            username: name || email.split('@')[0],
            anonymous_alias: `Stranger_${Math.floor(1000 + Math.random() * 9000)}`, // Required NOT NULL
            role: 'member',
            updated_at: new Date().toISOString()
        })
        .select('id')
        .single();

    if (error) {
        console.error('[UserService] Error creating skeleton user:', error);
        return null;
    }

    return created.id;
}

/**
 * Helper to fetch a user profile
 */
export async function getUserProfileByUserId(userId: string): Promise<UserRecord | null> {
    const supabase = createAdminClient();
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

    if (error) {
        console.error('[UserService] Error fetching profile:', error);
        return null;
    }
    return data;
}

export async function updateUserProfile(userId: string, data: {
    username?: string;
    bio?: string;
    anonymous_alias?: string;
    gender?: string;
    date_of_birth?: string;
    avatar_url?: string;
    phone?: string;
    email?: string;
}): Promise<UserRecord | null> {
    const supabase = createAdminClient();
    
    const { data: updatedUser, error } = await supabase
        .from('users')
        .update({
            ...data,
            updated_at: new Date().toISOString()
        })
        .eq('id', userId)
        .select()
        .single();

    if (error) {
        console.error('[UserService] Error updating profile:', error);
        return null;
    }
    return updatedUser;
}


/**
 * Link any orphaned subscriptions to a user record based on email or phone
 */
export async function linkSubscriptionToUser(userId: string, email: string, phone: string) {
    const supabase = createAdminClient();
    
    if (!email && !phone) return;

    // Build the query conditions for matching
    const conditions = [];
    if (email) conditions.push(`customer_email.eq.${email}`);
    if (phone) conditions.push(`customer_phone.eq.${phone}`);
    
    if (conditions.length === 0) return;

    // Update ALL subscriptions matching this email/phone that don't have a user_id yet
    const { error } = await supabase
        .from('user_subscriptions')
        .update({ 
            user_id: userId,
            updated_at: new Date().toISOString()
        })
        .or(conditions.join(','))
        .is('user_id', null);

    if (error) {
        console.error('[UserService] Error linking subscription:', error);
    }
}

/**
 * Fetch a user's subscription details with Proactive Sync
 */
export async function getUserSubscription(userId: string) {
    const supabase = createAdminClient();
    
    // 1. Get user email for robust fallback matching
    const { data: user } = await supabase
        .from('users')
        .select('email')
        .eq('id', userId)
        .maybeSingle();
    
    const userEmail = user?.email;

    // 2. Query by user_id OR customer_email (if available)
    const query = supabase.from('user_subscriptions').select('*');
    
    if (userEmail) {
        query.or(`user_id.eq.${userId},customer_email.eq.${userEmail}`);
    } else {
        query.eq('user_id', userId);
    }

    const { data: subscription, error } = await query
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error('[UserService] Error fetching user subscription:', error);
        return null;
    }

    // --- PROACTIVE SYNC: Fetch expiry from Razorpay if missing ---
    if (subscription && !subscription.current_period_end && subscription.razorpay_subscription_id) {
        try {
            console.log(`[UserService] Syncing expiry from Razorpay for sub: ${subscription.razorpay_subscription_id}`);
            const { getRazorpaySubscription } = await import('./razorpay');
            const subDetail = await getRazorpaySubscription(subscription.razorpay_subscription_id);
            
            if (subDetail.current_end) {
                const expiryDate = new Date(subDetail.current_end * 1000).toISOString();
                
                // Update local record
                await supabase
                    .from('user_subscriptions')
                    .update({ current_period_end: expiryDate })
                    .eq('id', subscription.id);
                
                // Update object in memory
                subscription.current_period_end = expiryDate;
            }
        } catch (syncErr) {
            console.error('[UserService] Razorpay sync failed:', syncErr);
        }
    }

    return subscription;
}
