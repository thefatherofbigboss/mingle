import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseClient';

export async function GET(request: NextRequest) {
  try {
    // 1. Security Check: Validate Secret Header
    const secretHeader = request.headers.get('x-internal-api-secret');
    if (secretHeader !== process.env.INTERNAL_API_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const queryParam = searchParams.get('q') || '';
    const roleParam = searchParams.get('role') || 'all';

    const supabase = createAdminClient();
    let query = (supabase
      .from('users') as any)
      .select('*')
      .order('created_at', { ascending: false });

    if (queryParam) {
      query = query.or(`email.ilike.%${queryParam}%,username.ilike.%${queryParam}%`);
    }
    
    if (roleParam !== 'all') {
      query = query.eq('role', roleParam);
    }

    const { data: users, error } = await query;
    if (error) {
      console.error('Error fetching users from DB:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(users || []);

  } catch (error: any) {
    console.error('Error in admin users API:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
