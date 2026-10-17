import { NextRequest, NextResponse } from 'next/server';
import { getInstagramCredentials } from '@/lib/instagram';

export async function GET(request: NextRequest) {
  try {
    const secretHeader = request.headers.get('x-internal-api-secret');
    if (secretHeader !== process.env.INTERNAL_API_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { token, instagramAccountId } = getInstagramCredentials();

    if (!token) {
      return NextResponse.json(
        { error: 'Instagram access token not configured in environment variables.' },
        { status: 400 }
      );
    }

    // Try graph.instagram.com/me/media or graph.facebook.com/v21.0/{id}/media
    const endpoint = `https://graph.instagram.com/v21.0/me/media?fields=id,caption,media_type,media_url,permalink,thumbnail_url,timestamp&limit=20&access_token=${token}`;

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      next: { revalidate: 60 }, // Cache for 60 seconds
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[Instagram Media API] Error fetching media:', data);
      // Fallback to graph.facebook.com if graph.instagram.com failed
      const fbEndpoint = `https://graph.facebook.com/v21.0/${instagramAccountId}/media?fields=id,caption,media_type,media_url,permalink,thumbnail_url,timestamp&limit=20&access_token=${token}`;
      const fbRes = await fetch(fbEndpoint);
      const fbData = await fbRes.json();
      if (!fbRes.ok) {
        return NextResponse.json({ error: fbData?.error?.message || data?.error?.message || 'Failed to fetch media' }, { status: 400 });
      }
      return NextResponse.json({ success: true, posts: fbData.data || [] });
    }

    return NextResponse.json({
      success: true,
      posts: data.data || [],
    });
  } catch (error: any) {
    console.error('[Instagram Media API] Exception:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
