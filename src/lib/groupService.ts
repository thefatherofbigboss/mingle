import { createClient } from "@supabase/supabase-js";
import { uploadToCloudinary } from "./cloudinary";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function createGroup(ownerId: string, name: string, description: string, locationId?: string, categoryId?: string, imageUrl?: string) {
    try {
        // 1. Create the group
        const { data: group, error: groupError } = await supabase
            .from('groups')
            .insert({
                name,
                description,
                owner_id: ownerId,
                location_id: locationId,
                category_id: categoryId,
                image_url: imageUrl
            })
            .select()
            .single();

        if (groupError) throw groupError;

        // 2. Add owner as admin member
        const { error: memberError } = await supabase
            .from('group_members')
            .insert({
                group_id: group.id,
                user_id: ownerId,
                role: 'owner'
            });

        if (memberError) throw memberError;

        return { success: true, group };
    } catch (error: any) {
        console.error('[GroupService] Error creating group:', error);
        return { success: false, error: error.message };
    }
}

export async function updateGroup(userId: string, groupId: string, updates: { 
    name?: string, 
    description?: string, 
    location_id?: string, 
    category_id?: string, 
    image_url?: string 
}) {
    try {
        // 1. Verify ownership
        const { data: group, error: checkError } = await supabase
            .from('groups')
            .select('owner_id')
            .eq('id', groupId)
            .single();

        if (checkError || group.owner_id !== userId) {
            return { success: false, error: 'Unauthorized: You do not own this group' };
        }

        // 2. Perform update
        const { data, error } = await supabase
            .from('groups')
            .update({
                ...updates,
                updated_at: new Date().toISOString()
            })
            .eq('id', groupId)
            .select()
            .single();

        if (error) throw error;
        return { success: true, group: data };
    } catch (error: any) {
        console.error('[GroupService] Error updating group:', error);
        return { success: false, error: error.message };
    }
}

export async function uploadGroupImage(userId: string, groupId: string, base64Data: string) {
    try {
        // 1. Verify ownership
        const { data: group, error: checkError } = await supabase
            .from('groups')
            .select('owner_id')
            .eq('id', groupId)
            .single();

        if (checkError || group.owner_id !== userId) {
            return { success: false, error: 'Unauthorized: You do not own this group' };
        }

        // 2. Upload to Cloudinary
        const result = await uploadToCloudinary(base64Data, 'profile_images');
        
        // 3. Update group record
        const { data, error } = await supabase
            .from('groups')
            .update({ image_url: result.secure_url })
            .eq('id', groupId)
            .select()
            .single();

        if (error) throw error;
        return { success: true, image_url: result.secure_url, group: data };
    } catch (error: any) {
        console.error('[GroupService] Error uploading group image:', error);
        return { success: false, error: error.message };
    }
}

export async function joinGroup(userId: string, groupId: string) {
    try {
        const { error } = await supabase
            .from('group_members')
            .insert({
                group_id: groupId,
                user_id: userId,
                role: 'member'
            });

        if (error) {
            if (error.code === '23505') {
                return { success: true, message: 'Already a member' };
            }
            throw error;
        }

        return { success: true };
    } catch (error: any) {
        console.error('[GroupService] Error joining group:', error);
        return { success: false, error: error.message };
    }
}

export async function leaveGroup(userId: string, groupId: string) {
    try {
        const { error } = await supabase
            .from('group_members')
            .delete()
            .eq('group_id', groupId)
            .eq('user_id', userId);

        if (error) throw error;
        return { success: true };
    } catch (error: any) {
        console.error('[GroupService] Error leaving group:', error);
        return { success: false, error: error.message };
    }
}

export async function getGroups(userId: string | null) {
    try {
        // userId might be 'undefined' string from some malformed RPC calls
        const cleanUserId = (userId && userId !== 'undefined') ? userId : null;
        const { data, error } = await supabase
            .from('groups')
            .select(`
                *,
                owner:users!owner_id (username, anonymous_alias, avatar_url),
                members_count:group_members(count),
                location:locations (*),
                category:categories (*)
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;
        
        // Enrich with membership status if userId provided
        let joinedGroupIds = new Set<string>();
        if (cleanUserId) {
            const { data: memberships } = await supabase
                .from('group_members')
                .select('group_id')
                .eq('user_id', cleanUserId);
            if (memberships) {
                memberships.forEach(m => joinedGroupIds.add(m.group_id));
            }
        }

        const enrichedGroups = data.map((g: any) => ({
            ...g,
            is_owner: cleanUserId ? g.owner_id === cleanUserId : false,
            is_joined: joinedGroupIds.has(g.id)
        }));

        return { success: true, groups: enrichedGroups };
    } catch (error: any) {
        console.error('[GroupService] Error fetching groups:', error);
        return { success: false, error: error.message };
    }
}

export async function getGroup(userId: string | null, groupId: string) {
    if (!groupId || groupId === 'undefined') {
        return { success: false, error: 'Invalid Group ID' };
    }
    try {
        const cleanUserId = (userId && userId !== 'undefined') ? userId : null;
        const { data, error } = await supabase
            .from('groups')
            .select(`
                *,
                owner:users!owner_id (username, anonymous_alias, avatar_url),
                members_count:group_members(count),
                location:locations (*),
                category:categories (*)
            `)
            .eq('id', groupId)
            .single();

        if (error) throw error;

        // Check membership for current user
        let isJoined = false;
        if (cleanUserId) {
            const { count } = await supabase
                .from('group_members')
                .select('*', { count: 'exact', head: true })
                .eq('group_id', groupId)
                .eq('user_id', cleanUserId);
            isJoined = !!count;
        }

        return { 
            success: true, 
            group: {
                ...data,
                is_owner: cleanUserId ? data.owner_id === cleanUserId : false,
                is_joined: isJoined
            }
        };
    } catch (error: any) {
        console.error('[GroupService] Error fetching group:', error);
        return { success: false, error: error.message };
    }
}

export async function getUserGroups(userId: string) {
    if (!userId || userId === 'undefined') {
        console.warn('[GroupService] getUserGroups called with invalid userId:', userId);
        return { success: true, owned: [], joined: [] }; // Silent fail for better UX on dashboard
    }
    try {
        const { data: memberships, error } = await supabase
            .from('group_members')
            .select(`
                group_id,
                role,
                group:groups (
                    *,
                    owner:users!owner_id (username, anonymous_alias, avatar_url),
                    members_count:group_members(count),
                    location:locations (*),
                    category:categories (*)
                )
            `)
            .eq('user_id', userId);

        if (error) throw error;

        const owned = memberships.filter(m => m.role === 'owner').map(m => ({
            ...m.group,
            is_owner: true,
            is_joined: true
        }));
        const joined = memberships.filter(m => m.role !== 'owner').map(m => ({
            ...m.group,
            is_owner: false,
            is_joined: true
        }));

        return { success: true, owned, joined };
    } catch (error: any) {
        console.error('[GroupService] Error fetching user groups:', error);
        return { success: false, error: error.message };
    }
}
