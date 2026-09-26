import { inngest } from '../client';
import { createAdminClient } from '@/lib/supabaseClient';

export const updateHostStats = inngest.createFunction(
  { 
    id: 'update-host-stats', 
    concurrency: 1,
    triggers: [{ event: 'host/stats.update' }]
  },
  async ({ event, step }: { event: any, step: any }) => {
    const { hostId } = event.data;

    const stats = await step.run('calculate-stats', async () => {
      const supabaseAdmin = createAdminClient();
      
      // get events
      const { data: events } = await supabaseAdmin.from('events').select('booking_count, likes_count, interests_count').eq('host_id', hostId);
      
      const totalBookings = events?.reduce((acc, curr) => acc + (curr.booking_count || 0), 0) || 0;
      const totalLikes = events?.reduce((acc, curr) => acc + (curr.likes_count || 0), 0) || 0;
      const totalInterests = events?.reduce((acc, curr) => acc + (curr.interests_count || 0), 0) || 0;
      const totalEngagement = totalLikes + totalInterests;

      // get payouts
      const { data: payouts } = await supabaseAdmin.from('payouts').select('net_amount').eq('host_id', hostId);
      const totalEarnings = payouts?.reduce((acc, curr) => acc + (parseFloat(curr.net_amount as unknown as string) || 0), 0) || 0;

      // get followers
      const { data: profile } = await supabaseAdmin.from('host_profiles').select('follower_count').eq('user_id', hostId).single();
      const followers = profile?.follower_count || 0;

      return { totalBookings, totalEngagement, totalEarnings, followers };
    });

    await step.run('update-db', async () => {
      const supabaseAdmin = createAdminClient();
      await supabaseAdmin.from('host_dashboard_stats').upsert({
        host_id: hostId,
        total_bookings: stats.totalBookings,
        total_engagement: stats.totalEngagement,
        total_earnings: stats.totalEarnings,
        followers: stats.followers,
        updated_at: new Date().toISOString()
      });
    });
    
    return { success: true, stats };
  }
);
