import { supabase as sharedClient, createAdminClient } from './supabaseClient';
import { toISTISOString, formatEventDate, formatEventTime } from './date-utils';

export { toISTISOString, formatEventDate, formatEventTime };


export interface TicketTier {
    id: string;
    event_id: string;
    name: string;
    description: string | null;
    tier_type: 'free' | 'paid' | 'donation';
    price: number;
    currency: string;
    total_quantity: number;
    sold_count: number;
    reserved_count: number;
    max_per_booking: number;
    min_per_booking: number;
    sale_start_at: string | null;
    sale_end_at: string | null;
    is_active: boolean;
    is_visible: boolean;
    sort_order: number;
}

export interface EventReview {
    id: string;
    event_id: string;
    user_id: string;
    rating: number;
    title: string | null;
    review_text: string | null;
    rating_venue?: number;
    rating_host?: number;
    rating_value?: number;
    helpful_count: number;
    created_at: string;
    user?: {
        username: string;
        avatar_url: string | null;
    };
}

export interface EventImage {
    id: string;
    event_id: string;
    image_url: string;
    alt_text: string | null;
    is_cover: boolean;
    sort_order: number;
}

export interface EventFAQ {
    id: string;
    event_id: string;
    question: string;
    answer: string;
    sort_order: number;
}

export interface EventAgenda {
    id: string;
    event_id: string;
    title: string;
    description: string | null;
    speaker: string | null;
    starts_at: string | null;
    ends_at: string | null;
    sort_order: number;
}

export interface EventTag {
    event_id: string;
    tag_id: string;
    tag?: {
        name: string;
        slug: string;
    };
}

export interface EventCohost {
    id: string;
    event_id: string;
    host_user_id: string;
    role: string | null;
    is_confirmed: boolean;
    user?: {
        username: string;
        avatar_url: string | null;
    };
}

// Database view interfaces
export interface PublicEventRow {
    id: string;
    location_id: string | null;
    title: string;
    slug: string;
    description: string | null;
    short_description: string | null;
    cover_image_url: string | null;
    event_type: 'in_person' | 'online' | 'hybrid';
    status: 'draft' | 'published' | 'cancelled' | 'completed' | 'suspended' | 'under_review';
    start_datetime: string;
    end_datetime: string;
    timezone: string;
    ticketing_mode: 'platform' | 'external' | 'free' | 'rsvp' | 'none';
    max_capacity: number | null;
    booking_count: number;
    likes_count: number;
    saves_count: number;
    views_count?: number;
    interests_count?: number;
    reviews_count?: number;
    is_recurring: boolean;
    created_at: string;
    updated_at: string;
    meta_description: string | null;
    meta_title: string | null;
    category_name: string;
    category_slug: string;
    category_color: string;
    venue_name: string | null;
    city: string | null;
    state: string | null;
    country: string;
    address_line1: string | null;
    address_line2: string | null;
    postal_code: string | null;
    latitude: number | null;
    longitude: number | null;
    google_maps_url: string | null;
    place_id: string | null;
    host_username: string;
    host_alias: string | null;
    host_display_name: string;
    host_logo: string | null;
    host_tagline: string | null;
}

export interface TicketAvailabilityRow {
    event_id: string;
    tier_id: string;
    tier_name: string;
    tier_type: string;
    price: number;
    currency: string;
    total_quantity: number;
    sold_count: number;
    reserved_count: number;
}

// Database Event interface matching the new database schema
export interface Event {
    id: string;
    host_id: string;
    category_id: string;
    location_id: string | null;
    title: string;
    slug: string;
    description: string | null;
    short_description: string | null;
    cover_image_url: string | null;
    event_type: 'in_person' | 'online' | 'hybrid';
    status: 'draft' | 'published' | 'cancelled' | 'completed' | 'suspended' | 'under_review';
    start_datetime: string; // ISO date string
    end_datetime: string; // ISO date string
    timezone: string;
    ticketing_mode: 'platform' | 'external' | 'free' | 'rsvp' | 'none';
    max_capacity: number | null;
    booking_count: number;
    likes_count: number;
    saves_count: number;
    views_count?: number;
    interests_count?: number;
    reviews_count?: number;
    rating_avg?: number;
    created_at: string;
    updated_at: string;
    meta_description?: string | null;
    meta_title?: string | null;

    // Joins
    ticket_tiers?: TicketTier[];
    category?: {
        name: string;
    } | null;
    host?: {
        id: string;
        username: string;
        anonymous_alias?: string;
        host_profile: {
            id: string;
            display_name: string;
            profile_image: string | null;
            tagline: string | null;
            city: string | null;
            follower_count: number;
            rating_avg: number;
            total_events_hosted: number;
            anonymous_alias?: string; // Duplicate for easy access
        } | null;
    } | null;
    location?: {
        venue_name: string | null;
        address_line1: string | null;
        address_line2: string | null;
        city: string | null;
        state: string | null;
        country: string;
        postal_code: string | null;
        latitude: number | null;
        longitude: number | null;
        google_maps_url: string | null;
        place_id: string | null;
    } | null;
    event_images?: EventImage[];
    event_faqs?: EventFAQ[];
    event_agenda?: EventAgenda[];
    event_tags?: EventTag[];
    event_cohosts?: EventCohost[];
    event_reviews?: EventReview[];
    is_recurring: boolean;
    
    // User interactions (set on fetch if user is logged in)
    user_has_liked?: boolean;
    user_has_saved?: boolean;
    user_has_booked?: boolean;
}

// PaymentDetail interface matching public.bookings
export interface PaymentDetail {
    id: string;
    booking_ref: string;
    user_id: string | null;
    event_id: string;
    status: 'pending' | 'confirmed' | 'cancelled' | 'refunded' | 'partially_refunded' | 'failed' | 'expired';
    payment_status: 'unpaid' | 'paid' | 'refunded' | 'partially_refunded' | 'failed';
    subtotal: number;
    discount_amount: number;
    total_amount: number;
    currency: string;
    razorpay_order_id: string | null;
    razorpay_payment_id: string | null;
    razorpay_signature: string | null;
    paid_at: string | null;
    attendee_name: string;
    attendee_email: string;
    attendee_phone: string | null;
    created_at: string;
    updated_at: string;
}

// Keep Booking as alias for backward compatibility
export type Booking = PaymentDetail;

// Event status suggestion based on dates and capacity
export function calculateEventStatus(event: Event): 'published' | 'cancelled' | 'completed' | 'suspended' {
    // If manually set to cancelled, keep it
    if (event.status === 'cancelled') {
        return 'cancelled';
    }

    const now = new Date();
    const endDate = new Date(event.end_datetime);

    // If event has passed, suggest completed
    if (endDate < now) {
        return 'completed';
    }

    // If fully booked, suggest completed (or handle via availability check)
    if (event.max_capacity && event.booking_count >= event.max_capacity) {
        return 'completed';
    }

    return 'published';
}

// Format event for display (helper functions)
export function formatEventPrice(event: Event): string {
    if (event.ticketing_mode === 'free') {
        return 'Free';
    }

    if (!event.ticket_tiers || event.ticket_tiers.length === 0) {
        return 'Contact for Price';
    }

    if (!event.ticket_tiers || event.ticket_tiers.length === 0) return 'TBA';

    // Get the lowest price from active tiers
    const activeTiers = event.ticket_tiers.filter(t => t.is_active !== false);
    if (activeTiers.length === 0) {
        const anyTiers = event.ticket_tiers;
        if (anyTiers.length === 0) return 'TBA';
        const minP = Math.min(...anyTiers.map(t => t.price));
        return `₹${minP.toFixed(0)}`;
    }

    const minPrice = Math.min(...activeTiers.map(t => t.price));
    const maxPrice = Math.max(...activeTiers.map(t => t.price));

    if (minPrice === 0 && maxPrice === 0) return 'Free';
    if (minPrice === maxPrice) return `₹${minPrice.toFixed(0)}`;

    return `₹${minPrice.toFixed(0)} - ₹${maxPrice.toFixed(0)}`;
}



/**
 * Returns an ISO string representation in Asia/Kolkata (+05:30)
 * Example: 2026-03-29T14:00:00+05:30
 */


export function getSpotsLabel(event: Event): string {
    if (!event.max_capacity) return 'Open';

    const remaining = event.max_capacity - event.booking_count;

    if (remaining <= 0) {
        return 'Sold Out';
    }

    if (remaining <= 3) {
        return 'Few Left';
    }

    if (remaining <= event.max_capacity * 0.2) {
        return 'Filling Fast';
    }

    if (remaining <= event.max_capacity * 0.5) {
        return 'Limited Spots';
    }

    return 'Open';
}

// Database query functions
export async function getEventsByCity(city: string): Promise<Event[]> {
    const supabase = sharedClient;

    // Query from public view
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('v_events_public')
        .select(`*`)
        .eq('status', 'published')
        .gte('end_datetime', now)
        .or(`city.ilike.%${city}%,title.ilike.%${city}%,event_type.eq.online`)
        .order('start_datetime', { ascending: true });

    if (error) {
        console.error('Error fetching events by city from view:', error);
        return [];
    }

    if (!data || data.length === 0) return [];

    // Fetch ticket tiers from availability view for these events
    const eventIds = data.map((e: PublicEventRow) => e.id);
    const { data: tiers, error: tiersError } = await supabase
        .from('v_ticket_availability')
        .select('*')
        .in('event_id', eventIds);

    if (tiersError) {
        console.error('Error fetching tiers from view:', tiersError);
    }

    return data.map((row: PublicEventRow) => mapPublicViewToEvent(row, tiers || []));
}

function mapPublicViewToEvent(row: PublicEventRow, tiers: TicketAvailabilityRow[]): Event {
    const eventTiers = tiers
        .filter((t: TicketAvailabilityRow) => t.event_id === row.id)
        .map((t: TicketAvailabilityRow) => ({
            id: t.tier_id,
            event_id: t.event_id,
            name: t.tier_name,
            description: null,
            tier_type: t.tier_type as TicketTier['tier_type'],
            price: Number(t.price),
            currency: t.currency,
            total_quantity: t.total_quantity,
            sold_count: t.sold_count,
            reserved_count: t.reserved_count,
            max_per_booking: 5, // Default
            min_per_booking: 1, // Default
            sale_start_at: null,
            sale_end_at: null,
            is_active: true,
            is_visible: true,
            sort_order: 0
        }));

    // Calculate total capacity and bookings from tiers if they are the source of truth
    const calculatedMaxCapacity = eventTiers.reduce((sum, t) => sum + (t.total_quantity || 0), 0);
    const calculatedBookingCount = eventTiers.reduce((sum, t) => sum + (t.sold_count || 0), 0);

    return {
        id: row.id,
        host_id: '', // Not in view but needed for type
        category_id: '', // Not in view but needed for type
        location_id: row.location_id || null,
        title: row.title,
        slug: row.slug,
        description: row.description || null,
        short_description: row.short_description,
        cover_image_url: row.cover_image_url,
        event_type: row.event_type as Event['event_type'],
        status: row.status as Event['status'],
        start_datetime: row.start_datetime,
        end_datetime: row.end_datetime,
        timezone: row.timezone,
        ticketing_mode: row.ticketing_mode as Event['ticketing_mode'],
        max_capacity: calculatedMaxCapacity || row.max_capacity,
        booking_count: calculatedBookingCount || row.booking_count,
        likes_count: row.likes_count,
        saves_count: row.saves_count,
        views_count: row.views_count,
        interests_count: row.interests_count,
        reviews_count: row.reviews_count,
        created_at: row.created_at || '',
        updated_at: row.updated_at || '',
        meta_description: row.meta_description,
        meta_title: row.meta_title,
        category: {
            name: row.category_name
        },
        location: {
            venue_name: row.venue_name,
            address_line1: row.address_line1,
            address_line2: row.address_line2,
            city: row.city,
            state: row.state,
            country: row.country,
            postal_code: row.postal_code,
            latitude: row.latitude ? Number(row.latitude) : null,
            longitude: row.longitude ? Number(row.longitude) : null,
            google_maps_url: row.google_maps_url,
            place_id: row.place_id
        },
        host: {
            id: '',
            username: row.host_username,
            anonymous_alias: row.host_alias || undefined,
            host_profile: {
                id: '',
                display_name: row.host_display_name,
                profile_image: row.host_logo,
                tagline: row.host_tagline,
                city: row.city,
                follower_count: 0,
                rating_avg: 0,
                total_events_hosted: 0,
                anonymous_alias: row.host_alias || undefined
            }
        },
        ticket_tiers: eventTiers,
        is_recurring: row.is_recurring
    };
}

export async function getAllLiveEvents(): Promise<Event[]> {
    const supabase = sharedClient;

    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('v_events_public')
        .select('*')
        .eq('status', 'published')
        .gte('end_datetime', now)
        .order('start_datetime', { ascending: true });

    if (error) {
        console.error('Error fetching all live events from view:', error);
        return [];
    }

    if (!data || data.length === 0) return [];

    // Fetch ticket tiers from availability view for these events
    const eventIds = data.map((e: PublicEventRow) => e.id);
    const { data: tiers, error: tiersError } = await supabase
        .from('v_ticket_availability')
        .select('*')
        .in('event_id', eventIds);

    if (tiersError) {
        console.error('Error fetching tiers from view:', tiersError);
    }

    return data.map((row: PublicEventRow) => mapPublicViewToEvent(row, tiers || []));
}

export async function getFeaturedEvents(limit: number = 6): Promise<Event[]> {
    const supabase = sharedClient;
    const now = new Date().toISOString();

    const { data, error } = await supabase
        .from('v_events_public')
        .select('*')
        .eq('is_featured', true)
        .gte('end_datetime', now)
        .order('start_datetime', { ascending: true })
        .limit(limit);

    if (error) {
        console.error('Error fetching featured events from view:', error);
        return [];
    }

    if (!data || data.length === 0) return [];

    const eventIds = data.map((e: PublicEventRow) => e.id);
    const { data: tiers } = await supabase
        .from('v_ticket_availability')
        .select('*')
        .in('event_id', eventIds);

    return data.map((row: PublicEventRow) => mapPublicViewToEvent(row, tiers || []));
}

export async function getSponsoredEvents(limit: number = 3): Promise<Event[]> {
    const supabase = sharedClient;

    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('v_events_public')
        .select('*')
        .eq('is_sponsored', true)
        .eq('status', 'published')
        .gte('end_datetime', now)
        .order('start_datetime', { ascending: true })
        .limit(limit);

    if (error) {
        console.error('Error fetching sponsored events from view:', error);
        return [];
    }

    if (!data || data.length === 0) return [];

    const eventIds = data.map((e: PublicEventRow) => e.id);
    const { data: tiers } = await supabase
        .from('v_ticket_availability')
        .select('*')
        .in('event_id', eventIds);

    return data.map((row: PublicEventRow) => mapPublicViewToEvent(row, tiers || []));
}

export async function getAllCompletedEvents(): Promise<Event[]> {
    const supabase = sharedClient;

    const { data, error } = await supabase
        .from('v_events_public')
        .select('*')
        .eq('status', 'completed')
        .order('start_datetime', { ascending: false });

    if (error) {
        console.error('Error fetching completed events from view:', error);
        return [];
    }

    if (!data || data.length === 0) return [];

    const eventIds = data.map((e: PublicEventRow) => e.id);
    const { data: tiers } = await supabase
        .from('v_ticket_availability')
        .select('*')
        .in('event_id', eventIds);

    return data.map((row: PublicEventRow) => mapPublicViewToEvent(row, tiers || []));
}


export async function getEventById(id: string): Promise<Event | null> {
    const supabase = sharedClient;

    const { data, error } = await supabase
        .from('events')
        .select(`
            *,
            category:categories(name),
            ticket_tiers!event_id(*),
            location:locations(*)
        `)
        .eq('id', id)
        .single();

    if (error) {
        console.error('Error fetching event by id:', error);
        return null;
    }

    return data;
}

// Public event query - only returns 'published' or 'completed' events (not 'cancelled')
export async function getPublicEventById(id: string): Promise<Event | null> {
    const supabase = sharedClient;

    // Proactively release any expired locks for this event so availability is laser-accurate
    try {
        await supabase.rpc('release_expired_locks_for_event', { p_event_id: id });
    } catch (e) {
        console.error('Silent failure releasing locks', e);
    }

    const { data: eventRow, error } = await supabase
        .from('v_events_public')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    if (error || !eventRow) {
        if (error && error.code !== 'PGRST116') {
            console.error('Error fetching public event by id from view:', error.message);
        }
        return null;
    }

    const { data: tiers } = await supabase
        .from('v_ticket_availability')
        .select('*')
        .eq('event_id', eventRow.id);

    const { data: images } = await supabase.from('event_images').select('*').eq('event_id', eventRow.id).order('sort_order', { ascending: true });
    const { data: faqs } = await supabase.from('event_faqs').select('*').eq('event_id', eventRow.id).order('sort_order', { ascending: true });
    const { data: agenda } = await supabase.from('event_agenda').select('*').eq('event_id', eventRow.id).order('sort_order', { ascending: true });
    const { data: tags } = await supabase.from('event_tags').select('tag:tags(name, slug)').eq('event_id', eventRow.id);
    const { data: reviews } = await supabase.from('event_reviews').select('*, user:users!event_reviews_user_id_fkey(username, avatar_url)').eq('event_id', eventRow.id);

    const event = mapPublicViewToEvent(eventRow, tiers || []);
    event.event_images = images || [];
    event.event_faqs = faqs || [];
    event.event_agenda = agenda || [];
    event.event_tags = tags as unknown as EventTag[];
    event.event_reviews = reviews as unknown as EventReview[];

    return event;
}


// Public event query by slug - only returns 'published' or 'completed' events (not 'cancelled')
export async function getPublicEventBySlug(slug: string): Promise<Event | null> {
    const supabase = sharedClient;

    if (!slug) {
        console.error('getPublicEventBySlug: slug is empty or undefined');
        return null;
    }

    // Check if slug looks like a UUID (backward compatibility)
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUuid = uuidPattern.test(slug);

    let query = supabase.from('v_events_public').select('*');
    if (isUuid) {
        query = query.eq('id', slug);
    } else {
        query = query.eq('slug', slug);
    }

    const { data: eventRow, error } = await query.maybeSingle();

    if (error || !eventRow) {
        if (error && error.code !== 'PGRST116') {
            console.error('Error fetching public event from view:', error.message);
        }
        return null;
    }

    // Proactively release any expired locks for the fetched event
    try {
        await supabase.rpc('release_expired_locks_for_event', { p_event_id: eventRow.id });
    } catch (e) {
        console.error('Silent failure releasing locks', e);
    }

    // Fetch related data (these might still be on restricted tables, 
    // but usually views join the necessary bits or these tables are public)
    // For now, let's assume we need to join them or query them separately.
    // The previous implementation used many joins.
    
    // Fetch tiers
    const { data: tiers } = await supabase
        .from('v_ticket_availability')
        .select('*')
        .eq('event_id', eventRow.id);

    // For other details like images, faq, etc. we might still need to query the original tables.
    // If the original tables are restricted, we might need views for them too or use admin client.
    // But let's try querying them first. Public users usually can see images and FAQs.
    
    const { data: images } = await supabase.from('event_images').select('*').eq('event_id', eventRow.id).order('sort_order', { ascending: true });
    const { data: faqs } = await supabase.from('event_faqs').select('*').eq('event_id', eventRow.id).order('sort_order', { ascending: true });
    const { data: agenda } = await supabase.from('event_agenda').select('*').eq('event_id', eventRow.id).order('sort_order', { ascending: true });
    const { data: tags } = await supabase.from('event_tags').select('tag:tags(name, slug)').eq('event_id', eventRow.id);
    const { data: reviews } = await supabase.from('event_reviews').select('*, user:users!event_reviews_user_id_fkey(username, avatar_url)').eq('event_id', eventRow.id);

    const event = mapPublicViewToEvent(eventRow, tiers || []);
    event.event_images = images || [];
    event.event_faqs = faqs || [];
    event.event_agenda = agenda || [];
    event.event_tags = tags as unknown as EventTag[];
    event.event_reviews = reviews as unknown as EventReview[];

    return event;
}

export async function createBooking(bookingData: {
    event_id: string;
    user_id?: string | null;
    attendee_name: string;
    attendee_email: string;
    attendee_phone?: string | null;
    total_amount: number;
    subtotal: number;
    discount_amount?: number;
    payment_status?: 'unpaid' | 'paid' | 'failed';
    razorpay_order_id?: string | null;
    items: {
        ticket_tier_id: string;
        quantity: number;
        unit_price: number;
        subtotal: number;
    }[];
}): Promise<Booking | null> {
    const supabase = createAdminClient();

    // Generate a unique booking reference
    const booking_ref = `BM-${Math.random().toString(36).substring(2, 8).toUpperCase()}-${Date.now().toString().slice(-4)}`;

    const { data: config } = await supabase.from('platform_config').select('*').single();
    const platform_fee_pct = config?.platform_fee_pct ?? 10;
    const gst_rate_pct = config?.gst_rate_pct ?? 18;

    const taxable_amount = bookingData.subtotal - (bookingData.discount_amount || 0);
    const platform_fee = taxable_amount * (platform_fee_pct / 100);
    const gst_on_fee = platform_fee * (gst_rate_pct / 100);
    const host_payout = taxable_amount - platform_fee - gst_on_fee;

    // Use a transaction (Supabase doesn't support multi-table transactions easily in JS client, 
    // but we can use a single insert with nested data if it was set up for that, 
    // or just perform sequential inserts since we don't have an RPC for this yet).
    
    const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .insert({
            booking_ref,
            event_id: bookingData.event_id,
            user_id: bookingData.user_id || null,
            attendee_name: bookingData.attendee_name,
            attendee_email: bookingData.attendee_email,
            attendee_phone: bookingData.attendee_phone || null,
            total_amount: bookingData.total_amount,
            subtotal: bookingData.subtotal,
            taxable_amount,
            platform_fee,
            gst_on_fee,
            host_payout,
            discount_amount: bookingData.discount_amount || 0,
            payment_status: bookingData.payment_status || 'unpaid',
            status: 'pending',
            razorpay_order_id: bookingData.razorpay_order_id || null,
        })
        .select()
        .single();

    if (bookingError || !booking) {
        console.error('Error creating booking:', bookingError);
        return null;
    }

    // Insert booking items
    const bookingItems = bookingData.items.map(item => ({
        booking_id: booking.id,
        ticket_tier_id: item.ticket_tier_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        subtotal: item.subtotal,
    }));

    const { error: itemsError } = await supabase
        .from('booking_items')
        .insert(bookingItems);

    if (itemsError) {
        console.error('Error creating booking items:', itemsError);
        // We might want to delete the booking here if it was a real transaction, 
        // but for now we'll just log it.
        return null;
    }

    return booking;
}

/**
 * Get upcoming events for a city, falling back to other cities if needed
 */
export async function getUpcomingEventsForCity(city: string, limit: number = 6): Promise<Event[]> {
    const supabase = sharedClient;
    const now = new Date().toISOString();

    // 1. Get events in the same city or online events
    const { data: cityEvents } = await supabase
        .from('v_events_public')
        .select('*')
        .eq('status', 'published')
        .gte('end_datetime', now)
        .or(`city.ilike.%${city}%,event_type.eq.online`)
        .order('start_datetime', { ascending: true })
        .limit(limit);

    let results = cityEvents || [];

    // 2. If we have less than the limit, fill with events from other cities
    if (results.length < limit) {
        const excludeIds = results.map((e: PublicEventRow) => e.id);
        const { data: otherEvents } = await supabase
            .from('v_events_public')
            .select('*')
            .eq('status', 'published')
            .gte('end_datetime', now)
            .not('id', 'in', `(${excludeIds.length > 0 ? excludeIds.join(',') : '00000000-0000-0000-0000-000000000000'})`)
            .order('start_datetime', { ascending: true })
            .limit(limit - results.length);
        
        if (otherEvents) {
            results = [...results, ...otherEvents];
        }
    }

    if (results.length > 0) {
        const eventIds = results.map((e: PublicEventRow) => e.id);
        const { data: tiers } = await supabase
            .from('v_ticket_availability')
            .select('*')
            .in('event_id', eventIds);

        return results.map((row: PublicEventRow) => mapPublicViewToEvent(row, tiers || []));
    }

    return [];
}

/**
 * Get events by host display name
 */
export async function getEventsByHostDisplayName(displayName: string): Promise<Event[]> {
    const supabase = sharedClient;

    const { data, error } = await supabase
        .from('v_events_public')
        .select('*')
        .eq('host_display_name', displayName)
        .order('start_datetime', { ascending: false });

    if (error) {
        console.error('Error fetching events by host display name:', error);
        return [];
    }

    if (!data || data.length === 0) return [];

    const eventIds = data.map((e: PublicEventRow) => e.id);
    const { data: tiers } = await supabase
        .from('v_ticket_availability')
        .select('*')
        .in('event_id', eventIds);

    return data.map((row: PublicEventRow) => mapPublicViewToEvent(row, tiers || []));
}
export async function getUpcomingEvents(limit: number = 6): Promise<Event[]> {
    const supabase = sharedClient;
    const now = new Date().toISOString();

    const { data, error } = await supabase
        .from('v_events_public')
        .select('*')
        .eq('status', 'published')
        .gte('end_datetime', now)
        .order('start_datetime', { ascending: true })
        .limit(limit);

    if (error) {
        console.error('Error fetching upcoming events:', error);
        return [];
    }

    if (!data || data.length === 0) return [];

    const eventIds = data.map((e: PublicEventRow) => e.id);
    const { data: tiers } = await supabase
        .from('v_ticket_availability')
        .select('*')
        .in('event_id', eventIds);

    return data.map((row: PublicEventRow) => mapPublicViewToEvent(row, tiers || []));
}

export async function getWeekendEvents(limit: number = 6): Promise<Event[]> {
    const supabase = sharedClient;
    const now = new Date().toISOString();

    // We can't strictly filter day of week in PostgREST unless we use an RPC or calculated columns.
    // So we fetch upcoming events and filter in JS.
    const { data, error } = await supabase
        .from('v_events_public')
        .select('*')
        .eq('status', 'published')
        .gte('end_datetime', now)
        .order('start_datetime', { ascending: true });

    if (error) {
        console.error('Error fetching weekend events:', error);
        return [];
    }

    if (!data || data.length === 0) return [];

    const weekendEvents = data.filter((row: PublicEventRow) => {
        const date = new Date(row.start_datetime);
        const day = date.getDay(); // 0: Sun, 5: Fri, 6: Sat
        return day === 0 || day === 5 || day === 6;
    }).slice(0, limit);

    if (weekendEvents.length === 0) return [];

    const eventIds = weekendEvents.map((e: PublicEventRow) => e.id);
    const { data: tiers } = await supabase
        .from('v_ticket_availability')
        .select('*')
        .in('event_id', eventIds);

    return weekendEvents.map((row: PublicEventRow) => mapPublicViewToEvent(row, tiers || []));
}

export async function getTrendingEvents(limit: number = 2): Promise<Event[]> {
    const supabase = sharedClient;
    const now = new Date().toISOString();

    const { data, error } = await supabase
        .from('v_events_public')
        .select('*')
        .eq('status', 'published')
        .gte('end_datetime', now)
        .order('booking_count', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('Error fetching trending events:', error);
        return [];
    }

    if (!data || data.length === 0) return [];

    const eventIds = data.map((e: PublicEventRow) => e.id);
    const { data: tiers } = await supabase
        .from('v_ticket_availability')
        .select('*')
        .in('event_id', eventIds);

    return data.map((row: PublicEventRow) => mapPublicViewToEvent(row, tiers || []));
}

/**
 * Get only online events
 */
export async function getOnlineEvents(limit: number = 10): Promise<Event[]> {
    const supabase = sharedClient;
    const now = new Date().toISOString();

    const { data, error } = await supabase
        .from('v_events_public')
        .select('*')
        .eq('status', 'published')
        .eq('event_type', 'online')
        .gte('end_datetime', now)
        .order('start_datetime', { ascending: true })
        .limit(limit);

    if (error) {
        console.error('Error fetching online events:', error);
        return [];
    }

    if (!data || data.length === 0) return [];

    const eventIds = data.map((e: PublicEventRow) => e.id);
    const { data: tiers } = await supabase
        .from('v_ticket_availability')
        .select('*')
        .in('event_id', eventIds);

    return data.map((row: PublicEventRow) => mapPublicViewToEvent(row, tiers || []));
}

/**
 * Get only recurring events
 */
export async function getRecurringEvents(limit: number = 10): Promise<Event[]> {
    const supabase = sharedClient;
    const now = new Date().toISOString();

    const { data, error } = await supabase
        .from('v_events_public')
        .select('*')
        .eq('status', 'published')
        .eq('is_recurring', true)
        .gte('end_datetime', now)
        .order('start_datetime', { ascending: true })
        .limit(limit);

    if (error) {
        console.error('Error fetching recurring events:', error);
        return [];
    }

    if (!data || data.length === 0) return [];

    const eventIds = data.map((e: PublicEventRow) => e.id);
    const { data: tiers } = await supabase
        .from('v_ticket_availability')
        .select('*')
        .in('event_id', eventIds);

    return data.map((row: PublicEventRow) => mapPublicViewToEvent(row, tiers || []));
}

export interface VenuePartner {
    venue_name: string;
    city: string;
    address: string;
    latitude: number | null;
    longitude: number | null;
    google_maps_url: string | null;
    event_count: number;
    // New fields from venue_partners table
    description?: string | null;
    cover_image_url?: string | null;
    website_url?: string | null;
    rating_avg?: number;
    rating_count?: number;
    amenities?: string[] | null;
    is_active?: boolean;
}

/**
 * Get all matching venue partners with optional filters
 */
export async function getAllVenuePartners(): Promise<VenuePartner[]> {
    const supabase = sharedClient;

    // 1. Fetch all locations that have coordinates, left joining with venue_partners
    const { data: locations, error: locError } = await supabase
        .from('locations')
        .select(`
            *,
            venue_partners!location_id(
                description,
                cover_image_url,
                website_url,
                rating_avg,
                rating_count,
                amenities,
                is_active
            )
        `)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null);

    if (locError) {
        console.error('Error fetching locations:', locError);
        return [];
    }

    // 2. Fetch event counts for all published events to show activity
    const { data: events, error: _eventError } = await supabase
        .from('v_events_public')
        .select('location_id')
        .eq('status', 'published');

    // Create a map for event counts per location
    const eventCountMap = new Map<string, number>();
    if (events) {
        events.forEach((e: any) => {
            if (e.location_id) {
                eventCountMap.set(e.location_id, (eventCountMap.get(e.location_id) || 0) + 1);
            }
        });
    }

    // 3. Map to VenuePartner interface
    return locations.map((loc: any) => {
        const partner = (loc.venue_partners as any)?.[0] || {};
        return {
            venue_name: loc.venue_name || 'Unnamed Venue',
            city: loc.city || 'India',
            address: loc.address_line1 || '',
            latitude: loc.latitude ? Number(loc.latitude) : null,
            longitude: loc.longitude ? Number(loc.longitude) : null,
            google_maps_url: loc.google_maps_url,
            event_count: eventCountMap.get(loc.id) || 0,
            description: partner.description || null,
            cover_image_url: partner.cover_image_url || null,
            website_url: partner.website_url || null,
            rating_avg: Number(partner.rating_avg) || 0,
            rating_count: Number(partner.rating_count) || 0,
            amenities: partner.amenities || [],
            is_active: partner.is_active !== false // Default to true
        } as VenuePartner;
    }).sort((a: VenuePartner, b: VenuePartner) => b.event_count - a.event_count);
}

/**
 * Get venue partners for a specific city
 */
export async function getVenuePartnersByCity(city: string): Promise<VenuePartner[]> {
    const supabase = sharedClient;

    // 1. Fetch locations in this city
    const { data: locations, error: locError } = await supabase
        .from('locations')
        .select(`
            *,
            venue_partners!location_id(
                description,
                cover_image_url,
                website_url,
                rating_avg,
                rating_count,
                amenities,
                is_active
            )
        `)
        .ilike('city', `%${city}%`);

    if (locError) {
        console.error(`Error fetching locations for city ${city}:`, locError);
        return [];
    }

    // 2. Fetch event counts for this city
    const { data: events } = await supabase
        .from('v_events_public')
        .select('location_id')
        .eq('status', 'published')
        .ilike('city', `%${city}%`);

    const eventCountMap = new Map<string, number>();
    if (events) {
        events.forEach((e: any) => {
            if (e.location_id) {
                eventCountMap.set(e.location_id, (eventCountMap.get(e.location_id) || 0) + 1);
            }
        });
    }

    // 3. Map output
    return locations.map((loc: any) => {
        const partner = (loc.venue_partners as any)?.[0] || {};
        return {
            venue_name: loc.venue_name || 'Unnamed Venue',
            city: loc.city || 'India',
            address: loc.address_line1 || '',
            latitude: loc.latitude ? Number(loc.latitude) : null,
            longitude: loc.longitude ? Number(loc.longitude) : null,
            google_maps_url: loc.google_maps_url,
            event_count: eventCountMap.get(loc.id) || 0,
            description: partner.description || null,
            cover_image_url: partner.cover_image_url || null,
            website_url: partner.website_url || null,
            rating_avg: Number(partner.rating_avg) || 0,
            rating_count: Number(partner.rating_count) || 0,
            amenities: partner.amenities || [],
            is_active: partner.is_active !== false
        } as VenuePartner;
    }).sort((a: VenuePartner, b: VenuePartner) => b.event_count - a.event_count);
}

/**
 * Get venue partners with upcoming events
 */
export async function getUpcomingVenuePartners(): Promise<VenuePartner[]> {
    const supabase = sharedClient;
    const now = new Date().toISOString();

    // 1. Get location_ids with upcoming events
    const { data: upcomingEvents, error: eventError } = await supabase
        .from('v_events_public')
        .select('location_id')
        .eq('status', 'published')
        .gte('end_datetime', now);

    if (eventError || !upcomingEvents) {
        console.error('Error fetching upcoming events:', eventError);
        return [];
    }

    const locationIds = Array.from(new Set(upcomingEvents.map((e: any) => e.location_id).filter(Boolean)));

    if (locationIds.length === 0) return [];

    // 2. Fetch these locations with partner metadata
    const { data: locations, error: locError } = await supabase
        .from('locations')
        .select(`
            *,
            venue_partners!location_id(
                description,
                cover_image_url,
                website_url,
                rating_avg,
                rating_count,
                amenities,
                is_active
            )
        `)
        .in('id', locationIds);

    if (locError) {
        console.error('Error fetching locations with upcoming events:', locError);
        return [];
    }

    // 3. Map event counts (overall published)
    const { data: allEvents } = await supabase
        .from('v_events_public')
        .select('location_id')
        .eq('status', 'published')
        .in('location_id', locationIds);

    const eventCountMap = new Map<string, number>();
    if (allEvents) {
        allEvents.forEach((e: any) => {
            if (e.location_id) {
                eventCountMap.set(e.location_id, (eventCountMap.get(e.location_id) || 0) + 1);
            }
        });
    }

    return locations.map((loc: any) => {
        const partner = (loc.venue_partners as any)?.[0] || {};
        return {
            venue_name: loc.venue_name || 'Unnamed Venue',
            city: loc.city || 'India',
            address: loc.address_line1 || '',
            latitude: loc.latitude ? Number(loc.latitude) : null,
            longitude: loc.longitude ? Number(loc.longitude) : null,
            google_maps_url: loc.google_maps_url,
            event_count: eventCountMap.get(loc.id) || 0,
            description: partner.description || null,
            cover_image_url: partner.cover_image_url || null,
            website_url: partner.website_url || null,
            rating_avg: Number(partner.rating_avg) || 0,
            rating_count: Number(partner.rating_count) || 0,
            amenities: partner.amenities || [],
            is_active: partner.is_active !== false
        } as VenuePartner;
    }).sort((a: VenuePartner, b: VenuePartner) => b.event_count - a.event_count);
}
