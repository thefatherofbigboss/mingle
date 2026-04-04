import { createAdminClient } from './supabaseClient';
import { PostgrestResponse } from '@supabase/supabase-js';

/**
 * Backend Chat Service
 * --------------------
 * Handles ALL database interactions for the 1:1 chat system.
 * Only the results are returned to the frontend.
 */

/**
 * Fetches the user's active conversations.
 * Each conversation will include the 'anonymous_alias' of the other person.
 */
export async function getConversations(userId: string) {
    const supabase = createAdminClient();

    // Fetch conversations where user is participant 1 or 2
    const { data: conversations, error } = await supabase
        .from('conversations')
        .select(`
            *,
            p1:participant_1_id(id, anonymous_alias, avatar_url),
            p2:participant_2_id(id, anonymous_alias, avatar_url)
        `)
        .or(`participant_1_id.eq.${userId},participant_2_id.eq.${userId}`)
        .order('last_message_at', { ascending: false });

    if (error) {
        console.error('[ChatService] Error fetching conversations:', error);
        return [];
    }

    // Process results to identify the 'other' person
    return conversations.map((conv: any) => {
        const isP1 = conv.participant_1_id === userId;
        const otherParticipant = isP1 ? conv.p2 : conv.p1;
        
        return {
            id: conv.id,
            last_message_at: conv.last_message_at,
            last_message_preview: conv.last_message_preview,
            other_participant: {
                id: otherParticipant.id,
                anonymous_alias: otherParticipant.anonymous_alias,
                avatar_url: otherParticipant.avatar_url
            },
            is_muted: isP1 ? conv.is_muted_by_p1 : conv.is_muted_by_p2,
            is_blocked: isP1 ? conv.is_blocked_by_p1 : conv.is_blocked_by_p2
        };
    });
}

/**
 * Fetches messages for a specific conversation.
 * Verifies that the user is indeed a participant of said conversation.
 */
export async function getMessages(conversationId: string, userId: string, limit = 50) {
    const supabase = createAdminClient();

    // 1. Verify membership
    const { data: conv } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversationId)
        .or(`participant_1_id.eq.${userId},participant_2_id.eq.${userId}`)
        .maybeSingle();

    if (!conv) {
        throw new Error('Access denied to this conversation');
    }

    // 2. Fetch messages
    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(limit);

    if (error) {
        console.error('[ChatService] Error fetching messages:', error);
        return [];
    }

    return data;
}

/**
 * Sends a new message in a conversation.
 * Updates the conversation's preview and timestamp.
 */
export async function sendMessage(conversationId: string, userId: string, content: string) {
    const supabase = createAdminClient();

    // 1. Insert message
    const { data: message, error: messageError } = await supabase
        .from('messages')
        .insert({
            conversation_id: conversationId,
            sender_id: userId,
            content: content,
            message_type: 'text'
        })
        .select()
        .single();

    if (messageError) {
        console.error('[ChatService] Error sending message:', messageError);
        throw messageError;
    }

    // 2. Update conversation metadata (async)
    await supabase.from('conversations').update({
        last_message_at: new Date().toISOString(),
        last_message_preview: content.length > 50 ? content.substring(0, 47) + '...' : content
    }).eq('id', conversationId);

    // 3. Broadcast refresh signal (non-blocking)
    const channel = supabase.channel(`conversation:${conversationId}`);
    channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            channel.send({
                type: 'broadcast',
                event: 'refresh',
                payload: { conversation_id: conversationId, sender_id: userId }
            }).then(() => {
                supabase.removeChannel(channel);
            });
        }
    });

    return message;
}

/**
 * Starts a new 1:1 conversation between two users.
 * Returns existing conversation if it exists.
 */
export async function startConversation(userId: string, targetUserId: string) {
    const supabase = createAdminClient();

    if (userId === targetUserId) {
        throw new Error('You cannot start a conversation with yourself.');
    }

    // Normalize IDs to prevent duplicate pairs (p1 < p2)
    const [p1, p2] = [userId, targetUserId].sort();

    // 1. Check for existing
    const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('participant_1_id', p1)
        .eq('participant_2_id', p2)
        .maybeSingle();

    if (existing) return existing.id;

    // 2. Create new
    const { data: created, error } = await supabase
        .from('conversations')
        .insert({
            participant_1_id: p1,
            participant_2_id: p2
        })
        .select('id')
        .single();

    if (error) {
        console.error('[ChatService] Error starting conversation:', error);
        throw error;
    }

    return created.id;
}

/**
 * Returns other members that the user can chat with.
 */
export async function getAvailableMembers(userId: string, limit = 20) {
    const supabase = createAdminClient();

    const { data, error } = await supabase
        .from('users')
        .select('id, anonymous_alias, avatar_url')
        .neq('id', userId)
        .eq('role', 'member')
        .limit(limit);

    if (error) {
        console.error('[ChatService] Error fetching members:', error);
        return [];
    }

    return data;
}
