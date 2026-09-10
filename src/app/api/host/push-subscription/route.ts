import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseClient';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { hostId, subscription, userAgent } = body;

    if (!hostId || !subscription || !subscription.endpoint) {
      return NextResponse.json(
        { error: 'Missing hostId or valid push subscription' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Remove any existing subscription with the same endpoint to prevent duplicates
    const endpoint = subscription.endpoint;
    const { data: existing } = await supabase
      .from('host_push_subscriptions')
      .select('id, subscription')
      .eq('host_id', hostId);

    if (existing && existing.length > 0) {
      const duplicateIds = existing
        .filter((row: any) => {
          const sub = typeof row.subscription === 'string' ? JSON.parse(row.subscription) : row.subscription;
          return sub?.endpoint === endpoint;
        })
        .map((row: any) => row.id);

      if (duplicateIds.length > 0) {
        await supabase
          .from('host_push_subscriptions')
          .delete()
          .in('id', duplicateIds);
      }
    }

    const { data, error } = await supabase
      .from('host_push_subscriptions')
      .insert({
        host_id: hostId,
        subscription: subscription,
        user_agent: userAgent || req.headers.get('user-agent') || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[PushSubscription] DB error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[PushSubscription] Registered push subscription for host ${hostId}`);
    return NextResponse.json({ success: true, id: data?.id });
  } catch (err: any) {
    console.error('[PushSubscription] Server error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { hostId, endpoint } = body;

    if (!hostId || !endpoint) {
      return NextResponse.json({ error: 'Missing hostId or endpoint' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data: existing } = await supabase
      .from('host_push_subscriptions')
      .select('id, subscription')
      .eq('host_id', hostId);

    if (existing) {
      const matchIds = existing
        .filter((row: any) => {
          const sub = typeof row.subscription === 'string' ? JSON.parse(row.subscription) : row.subscription;
          return sub?.endpoint === endpoint;
        })
        .map((row: any) => row.id);

      if (matchIds.length > 0) {
        await supabase
          .from('host_push_subscriptions')
          .delete()
          .in('id', matchIds);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
