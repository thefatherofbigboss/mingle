import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseClient';

export async function POST(request: NextRequest) {
  try {
    // 1. Security Check: Validate Secret Header
    const secretHeader = request.headers.get('x-internal-api-secret');
    if (secretHeader !== process.env.INTERNAL_API_SECRET) {
      console.warn('[Admin DB Proxy] Unauthorized Attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { table, action, selectQuery = '*', filters = [], data, single = false, maybeSingle = false } = body;

    if (!table) {
      return NextResponse.json({ error: 'Missing table parameter' }, { status: 400 });
    }

    const supabase = createAdminClient();
    let queryBuilder: any = supabase.from(table);

    // Apply action
    if (action === 'select') {
      queryBuilder = queryBuilder.select(selectQuery);
    } else if (action === 'insert') {
      queryBuilder = queryBuilder.insert(data).select(selectQuery);
    } else if (action === 'update') {
      queryBuilder = queryBuilder.update(data).select(selectQuery);
    } else if (action === 'delete') {
      queryBuilder = queryBuilder.delete().select(selectQuery);
    } else if (action === 'upsert') {
      queryBuilder = queryBuilder.upsert(data).select(selectQuery);
    } else {
      return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 });
    }

    // Apply filters sequentially
    for (const filter of filters) {
      const { type, args = [] } = filter;
      if (typeof queryBuilder[type] === 'function') {
        queryBuilder = queryBuilder[type](...args);
      } else {
        console.warn(`[Admin DB Proxy] Filter type ${type} is not a function on QueryBuilder`);
      }
    }

    // Apply single / maybeSingle modifiers
    if (single) {
      queryBuilder = queryBuilder.single();
    } else if (maybeSingle) {
      queryBuilder = queryBuilder.maybeSingle();
    }

    const { data: dbResult, error } = await queryBuilder;

    if (error) {
      console.error(`[Admin DB Proxy] Database error during ${action} on ${table}:`, error);
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }

    return NextResponse.json({ data: dbResult });

  } catch (error: any) {
    console.error('[Admin DB Proxy] Fatal error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
