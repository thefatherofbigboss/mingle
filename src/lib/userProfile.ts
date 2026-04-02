import { v5 as uuidv5 } from 'uuid';
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
export async function syncFirebaseUser(firebaseUser: { 
    uid: string; 
    email?: string; 
    displayName?: string; 
    phoneNumber?: string; 
    mappedUserId: string; // This is the deterministic UUID v5
}): Promise<UserRecord | null> {
    const supabase = createAdminClient(); // Bypass RLS for initial sync
    const { mappedUserId, uid, email, displayName, phoneNumber } = firebaseUser;

    // First check if the user already exists in public.users
    const { data: existingUser, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('id', mappedUserId)
        .maybeSingle();

    if (fetchError) {
        console.error('[UserService] Error checking user existence:', fetchError);
        return null;
    }

    if (existingUser) {
        // Link any pending subscriptions to this user
        await linkSubscriptionToUser(mappedUserId, email || '', phoneNumber || '');
        return existingUser;
    }

    // Create new record for the user
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

    // Link any pending subscriptions to this new user record
    await linkSubscriptionToUser(mappedUserId, email || '', phoneNumber || '');

    return newUser;
}

/**
 * Helper to fetch a user profile (aliased to userProfile to maintain backward compatibility)
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

    console.log(`[UserService] Attempting to link subscriptions for user ${userId} (Email: ${email}, Phone: ${phone})`);
    
    // Build the query conditions
    const conditions = [];
    if (email) conditions.push(`customer_email.eq.${email}`);
    if (phone) conditions.push(`customer_phone.eq.${phone}`);
    
    if (conditions.length === 0) return;

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
 * Fetch a user's subscription details
 */
export async function getUserSubscription(userId: string) {
    const supabase = createAdminClient();
    const { data, error } = await supabase
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error('[UserService] Error fetching user subscription:', error);
    }
    return data;
}
