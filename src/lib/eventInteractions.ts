import { createAdminClient } from './supabaseClient';

export async function toggleEventLike(eventId: string, userId: string, isLiked: boolean) {
    const supabase = createAdminClient();
    if (isLiked) {
        // Unlike - delete from event_likes
        const { error } = await supabase
            .from('event_likes')
            .delete()
            .match({ event_id: eventId, user_id: userId });
        
        if (error) throw error;
        return { action: 'unliked' };
    } else {
        // Like - insert into event_likes
        const { error } = await supabase
            .from('event_likes')
            .insert({ event_id: eventId, user_id: userId });
        
        if (error) throw error;
        return { action: 'liked' };
    }
}

export async function toggleEventSave(eventId: string, userId: string, isSaved: boolean) {
    const supabase = createAdminClient();
    if (isSaved) {
        const { error } = await supabase
            .from('event_saves')
            .delete()
            .match({ event_id: eventId, user_id: userId });
        
        if (error) throw error;
        return { action: 'unsaved' };
    } else {
        const { error } = await supabase
            .from('event_saves')
            .insert({ event_id: eventId, user_id: userId });
        
        if (error) throw error;
        return { action: 'saved' };
    }
}

export async function setEventInterest(eventId: string, userId: string, interestType: 'interested' | 'going' | 'not_going' | null) {
    const supabase = createAdminClient();
    if (!interestType) {
        const { error } = await supabase
            .from('event_interests')
            .delete()
            .match({ event_id: eventId, user_id: userId });
        
        if (error) throw error;
        return { action: 'removed' };
    } else {
        const { error } = await supabase
            .from('event_interests')
            .upsert({ 
                event_id: eventId, 
                user_id: userId, 
                interest_type: interestType 
            }, { onConflict: 'event_id,user_id' });
        
        if (error) throw error;
        return { action: interestType };
    }
}

export async function submitEventReview(reviewData: {
    event_id: string;
    user_id: string;
    booking_id?: string;
    rating: number;
    title?: string;
    review_text?: string;
    rating_venue?: number;
    rating_host?: number;
    rating_value?: number;
}) {
    const supabase = createAdminClient();
    const { data, error } = await supabase
        .from('event_reviews')
        .insert({
            ...reviewData,
            is_approved: true // Default to auto-approve for now, or change as per policy
        })
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

export async function checkUserInteraction(eventId: string, userId: string) {
    const supabase = createAdminClient();
    const [likeRes, saveRes, bookingRes, interestRes] = await Promise.all([
        supabase.from('event_likes').select('id').match({ event_id: eventId, user_id: userId }).maybeSingle(),
        supabase.from('event_saves').select('id').match({ event_id: eventId, user_id: userId }).maybeSingle(),
        supabase.from('bookings').select('id').match({ event_id: eventId, user_id: userId, status: 'confirmed' }).maybeSingle(),
        supabase.from('event_interests').select('interest_type').match({ event_id: eventId, user_id: userId }).maybeSingle()
    ]);

    return {
        liked: !!likeRes.data,
        saved: !!saveRes.data,
        booked: !!bookingRes.data,
        interest: interestRes.data?.interest_type || null
    };
}

export async function joinEventWaitlist(userId: string, eventId: string) {
    const supabase = createAdminClient();
    
    // Check if already in waitlist
    const { data: existing } = await supabase
        .from('event_waitlist')
        .select('id')
        .eq('event_id', eventId)
        .eq('user_id', userId)
        .maybeSingle();

    if (existing) {
        return { action: 'already_joined', message: 'You are already on the waitlist.' };
    }

    // Get current position (simple count)
    const { count } = await supabase
        .from('event_waitlist')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', eventId);

    const { error } = await supabase
        .from('event_waitlist')
        .insert({
            event_id: eventId,
            user_id: userId,
            position: (count || 0) + 1,
            status: 'waiting'
        });

    if (error) throw error;
    return { action: 'joined', message: 'You have been added to the waitlist!' };
}

export async function getEventDiscussions(eventId: string) {
    const supabase = createAdminClient();
    const { data, error } = await supabase
        .from('event_discussions')
        .select(`
            *,
            user:users!event_discussions_user_id_fkey(username, avatar_url)
        `)
        .eq('event_id', eventId)
        .is('is_deleted', false)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: true });
        
    if (error) throw error;
    return data;
}

export async function postEventDiscussion(userId: string, eventId: string, parentId: string | null, message: string) {
    const supabase = createAdminClient();
    const { data, error } = await supabase
        .from('event_discussions')
        .insert({
            event_id: eventId,
            user_id: userId,
            parent_id: parentId,
            message: message.trim(),
            is_host_reply: false
        })
        .select()
        .single();
        
    if (error) throw error;
    return data;
}

export async function likeEventDiscussion(userId: string, messageId: string) {
    const supabase = createAdminClient();
    const { error: rpcError } = await supabase.rpc('increment_discussion_like', { msg_id: messageId });
    const { error: insertError } = await supabase
        .from('discussion_likes')
        .insert({ discussion_id: messageId, user_id: userId });
        
    if (insertError && rpcError) throw insertError;
    return { success: true };
}

export async function deleteEventDiscussion(userId: string, messageId: string) {
    const supabase = createAdminClient();
    const { error } = await supabase
        .from('event_discussions')
        .update({ is_deleted: true, deleted_by: userId })
        .eq('id', messageId);
        
    if (error) throw error;
    return { success: true };
}
