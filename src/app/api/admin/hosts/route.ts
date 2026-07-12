import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseClient';

export async function POST(request: NextRequest) {
  try {
    // 1. Security Check: Validate Secret Header
    const secretHeader = request.headers.get('x-internal-api-secret');
    if (secretHeader !== process.env.INTERNAL_API_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      user_id,
      display_name,
      host_type,
      organisation_name,
      tagline,
      description,
      city,
      state,
      country,
      website_url,
      instagram_handle
    } = body;

    if (!user_id || !display_name || !host_type) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // 1. Generate slug
    const baseSlug = display_name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const slug = `${baseSlug}-${randomSuffix}`;

    // 2. Insert host profile
    const { data: hostProfile, error: insertError } = await supabase
      .from('host_profiles')
      .insert({
        user_id,
        display_name,
        host_type,
        organisation_name: organisation_name || null,
        tagline: tagline || null,
        description: description || null,
        city: city || null,
        state: state || null,
        country: country || null,
        website_url: website_url || null,
        instagram_handle: instagram_handle || null,
        is_approved: true,
        kyc_status: 'verified',
        slug
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting host profile:', insertError);
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }

    // 3. Update user role to 'host'
    const { error: userError } = await supabase
      .from('users')
      .update({ role: 'host' })
      .eq('id', user_id);

    if (userError) {
      console.error('Error updating user role:', userError);
      // Don't fail the whole request since profile is created, but log it
    }

    return NextResponse.json({ success: true, hostProfile });

  } catch (error: any) {
    console.error('Error in create host profile API:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
