import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseClient';

export async function GET(request: NextRequest) {
  try {
    // 1. Security Check: Validate Secret Header
    const secretHeader = request.headers.get('x-internal-api-secret');
    if (secretHeader !== process.env.INTERNAL_API_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    // 1. Total users
    const { count: totalUsers, error: err1 } = await (supabase
      .from('users') as any)
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    // 2. Total events
    const { count: totalEvents, error: err2 } = await (supabase
      .from('events') as any)
      .select('*', { count: 'exact', head: true })
      .eq('status', 'published');

    // 3. Bookings today
    const { count: bookingsToday, error: err3 } = await (supabase
      .from('bookings') as any)
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayISO);

    // 4. Revenue today (platform_fee)
    const { data: revenueData, error: err4 } = await (supabase
      .from('bookings') as any)
      .select('platform_fee')
      .gte('paid_at', todayISO);

    const revenueToday = (revenueData as any[])?.reduce((acc: number, curr: any) => acc + Number(curr.platform_fee), 0) || 0;

    // Recent activity: Last 10 bookings
    const { data: recentBookings, error: err5 } = await (supabase
      .from('bookings') as any)
      .select('booking_ref, total_amount, created_at, event:events(title)')
      .order('created_at', { ascending: false })
      .limit(10);

    // Last 5 new users
    const { data: recentUsers, error: err6 } = await (supabase
      .from('users') as any)
      .select('username, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    // Pending host approvals count
    const { count: pendingHosts, error: err7 } = await (supabase
      .from('host_profiles') as any)
      .select('*', { count: 'exact', head: true })
      .eq('is_approved', false);

    // Pending reports count
    const { count: pendingReports, error: err8 } = await (supabase
      .from('reports') as any)
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (err1 || err2 || err3 || err4 || err5 || err6 || err7 || err8) {
      console.error('Database query error in admin stats:', { err1, err2, err3, err4, err5, err6, err7, err8 });
    }

    return NextResponse.json({
      totalUsers: totalUsers || 0,
      totalEvents: totalEvents || 0,
      bookingsToday: bookingsToday || 0,
      revenueToday,
      recentBookings: recentBookings || [],
      recentUsers: recentUsers || [],
      pendingHosts: pendingHosts || 0,
      pendingReports: pendingReports || 0
    });

  } catch (error: any) {
    console.error('Error in admin stats API:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
