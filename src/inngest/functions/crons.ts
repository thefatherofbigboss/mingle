import { inngest } from '../client';
import { createAdminClient } from '@/lib/supabaseClient';

/**
 * Runs every 15 minutes to expire pending waitlist offers and promote waiting attendees.
 */
export const expireWaitlistOffersCron = inngest.createFunction(
    { 
        id: 'expire-waitlist-offers-cron', 
        name: 'Expire Waitlist Offers',
        retries: 2,
        triggers: [{ cron: '*/15 * * * *' }],
    },
    async ({ step }) => {
        const result = await step.run('process-expired-offers', async () => {
            const supabase = createAdminClient();

            // 1. Fetch expired offers
            const { data: expiredOffers, error: expiredError } = await supabase
                .from('event_waitlist')
                .select('id, event_id, ticket_tier_id')
                .eq('status', 'offered')
                .lt('offer_expires_at', new Date().toISOString());

            if (expiredError) throw expiredError;

            if (!expiredOffers || expiredOffers.length === 0) {
                return { processed: 0 };
            }

            const processedCounts: Record<string, number> = {};

            for (const offer of expiredOffers) {
                await supabase
                    .from('event_waitlist')
                    .update({ status: 'expired' })
                    .eq('id', offer.id);

                const key = `${offer.event_id}_${offer.ticket_tier_id}`;
                processedCounts[key] = (processedCounts[key] || 0) + 1;
            }

            // 2. Re-offer to next people in queue
            for (const key of Object.keys(processedCounts)) {
                const [eventId, ticketTierId] = key.split('_');
                const quantity = processedCounts[key];

                const { data: waitlistUsers } = await supabase
                    .from('event_waitlist')
                    .select('id, user_id, position')
                    .eq('event_id', eventId)
                    .eq('ticket_tier_id', ticketTierId)
                    .eq('status', 'waiting')
                    .order('position', { ascending: true })
                    .limit(quantity);

                if (waitlistUsers && waitlistUsers.length > 0) {
                    const { data: event } = await supabase
                        .from('events')
                        .select('title')
                        .eq('id', eventId)
                        .single();

                    const eventTitle = event?.title || 'an event';

                    for (const waitlister of waitlistUsers) {
                        const expiresAt = new Date();
                        expiresAt.setHours(expiresAt.getHours() + 4);

                        await supabase
                            .from('event_waitlist')
                            .update({
                                status: 'offered',
                                notified_at: new Date().toISOString(),
                                offer_expires_at: expiresAt.toISOString(),
                            })
                            .eq('id', waitlister.id);

                        const notificationData = {
                            user_id: waitlister.user_id,
                            type: 'waitlist_offer',
                            title: `A ticket is available for ${eventTitle}`,
                            body: 'You have 4 hours to book your ticket before the offer expires.',
                            related_id: eventId,
                            related_type: 'event',
                        };

                        await supabase.from('notifications').insert([
                            { ...notificationData, channel: 'in_app' },
                            { ...notificationData, channel: 'email' },
                        ]);
                    }
                }
            }

            return { processed: expiredOffers.length };
        });

        return result;
    }
);

/**
 * Runs hourly to send 24-hour and 1-hour event reminder notifications.
 */
export const eventRemindersCron = inngest.createFunction(
    { 
        id: 'event-reminders-cron', 
        name: 'Hourly Event Reminders',
        retries: 2,
        triggers: [{ cron: '0 * * * *' }],
    },
    async ({ step }) => {
        const result = await step.run('send-reminders', async () => {
            const supabase = createAdminClient();
            const now = new Date();

            const start24h = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString();
            const end24h = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString();

            const start1h = new Date(now.getTime()).toISOString();
            const end1h = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

            const fetchEvents = async (start: string, end: string) => {
                const { data, error } = await supabase
                    .from('events')
                    .select('id, title, start_datetime, location:locations(venue_name)')
                    .gte('start_datetime', start)
                    .lte('start_datetime', end)
                    .eq('status', 'published');
                if (error) throw error;
                return data;
            };

            const events24h = (await fetchEvents(start24h, end24h)) || [];
            const events1h = (await fetchEvents(start1h, end1h)) || [];

            let reminder24h = 0;
            let reminder1h = 0;

            const processReminders = async (events: any[], type: string) => {
                for (const event of events) {
                    const { data: bookings } = await supabase
                        .from('bookings')
                        .select('user_id')
                        .eq('event_id', event.id)
                        .eq('status', 'confirmed');

                    if (bookings) {
                        for (const booking of bookings) {
                            try {
                                const venue = event.location?.venue_name || 'the venue';
                                const body = type === 'event_reminder_24h'
                                    ? `Reminder: ${event.title} is happening in 24 hours at ${venue}.`
                                    : `Reminder: ${event.title} starts in 1 hour!`;

                                await supabase.from('notifications').insert([
                                    {
                                        user_id: booking.user_id,
                                        type,
                                        title: 'Event Reminder',
                                        body,
                                        channel: 'in_app',
                                    },
                                    {
                                        user_id: booking.user_id,
                                        type,
                                        title: 'Event Reminder',
                                        body,
                                        channel: 'email',
                                    },
                                ]);

                                if (type === 'event_reminder_24h') reminder24h++;
                                else reminder1h++;
                            } catch (e) {
                                console.error('Error recording reminder notification:', e);
                            }
                        }
                    }
                }
            };

            await processReminders(events24h, 'event_reminder_24h');
            await processReminders(events1h, 'event_reminder_1h');

            return { success: true, reminder24h, reminder1h };
        });

        return result;
    }
);

/**
 * Runs daily at 10:00 AM to notify users of events matching their saved searches.
 */
export const processSavedSearchesCron = inngest.createFunction(
    { 
        id: 'process-saved-searches-cron', 
        name: 'Process Saved Searches Daily Alert',
        retries: 2,
        triggers: [{ cron: '0 10 * * *' }],
    },
    async ({ step }) => {
        const result = await step.run('match-and-notify', async () => {
            const supabase = createAdminClient();
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);

            const { data: searches, error: searchError } = await supabase
                .from('saved_searches')
                .select('*')
                .eq('alert_enabled', true);

            if (searchError) throw searchError;

            let totalNotifications = 0;

            for (const search of searches || []) {
                let query = supabase
                    .from('v_events_public')
                    .select('id, title, start_datetime')
                    .gte('created_at', yesterday.toISOString());

                if (search.city) {
                    query = query.eq('city', search.city);
                }
                if (search.category_id) {
                    query = query.eq('category_id', search.category_id);
                }
                if (search.keyword) {
                    query = query.textSearch('fts', search.keyword);
                }
                if (search.max_price) {
                    query = query.lte('min_price', search.max_price);
                }

                const { data: newEvents, error: eventError } = await query;

                if (!eventError && newEvents && newEvents.length > 0) {
                    const body = `We found ${newEvents.length} new events matching your saved search "${search.label || 'Search'}".`;

                    const notificationData = {
                        user_id: search.user_id,
                        type: 'saved_search_alert',
                        title: 'New Events Found!',
                        body,
                    };

                    await supabase.from('notifications').insert([
                        { ...notificationData, channel: 'in_app' },
                        { ...notificationData, channel: 'email' },
                    ]);

                    totalNotifications++;
                }
            }

            return { success: true, notificationsSent: totalNotifications };
        });

        return result;
    }
);

/**
 * Runs daily at 1:00 AM to record analytics snapshot for yesterday.
 */
export const analyticsSnapshotCron = inngest.createFunction(
    { 
        id: 'analytics-snapshot-cron', 
        name: 'Daily Analytics Snapshot',
        retries: 2,
        triggers: [{ cron: '0 1 * * *' }],
    },
    async ({ step }) => {
        const result = await step.run('compute-daily-analytics', async () => {
            const supabase = createAdminClient();

            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            // 1. New Users
            const { count: newUsers } = await supabase
                .from('users')
                .select('*', { count: 'exact', head: true })
                .gte('created_at', yesterdayStr + 'T00:00:00Z')
                .lt('created_at', yesterdayStr + 'T23:59:59Z');

            // 2. New Events
            const { count: newEvents } = await supabase
                .from('events')
                .select('*', { count: 'exact', head: true })
                .gte('created_at', yesterdayStr + 'T00:00:00Z')
                .lt('created_at', yesterdayStr + 'T23:59:59Z');

            // 3. Bookings & Revenue
            const { data: bookingStats } = await supabase
                .from('bookings')
                .select('platform_fee, total_amount')
                .eq('status', 'confirmed')
                .gte('paid_at', yesterdayStr + 'T00:00:00Z')
                .lt('paid_at', yesterdayStr + 'T23:59:59Z');

            const totalBookings = bookingStats?.length || 0;
            const totalRevenue = bookingStats?.reduce((acc, curr) => acc + Number(curr.total_amount || 0), 0) || 0;
            const totalPlatformFee = bookingStats?.reduce((acc, curr) => acc + Number(curr.platform_fee || 0), 0) || 0;

            const { error } = await supabase
                .from('analytics_daily')
                .insert({
                    snapshot_date: yesterdayStr,
                    metric_type: 'platform',
                    new_users: newUsers || 0,
                    new_events: newEvents || 0,
                    total_bookings: totalBookings,
                    total_revenue: totalRevenue,
                    total_platform_fee: totalPlatformFee,
                });

            if (error) throw error;

            return { success: true, date: yesterdayStr, newUsers, newEvents, totalBookings, totalRevenue };
        });

        return result;
    }
);
