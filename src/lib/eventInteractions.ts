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
