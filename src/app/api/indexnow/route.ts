import { NextRequest, NextResponse } from 'next/server';

const INDEXNOW_KEY = process.env.INDEXNOW_KEY || '';
const INDEXNOW_ENDPOINT = process.env.INDEXNOW_ENDPOINT || 'https://api.indexnow.org/indexnow';
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.strangermingle.com';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { urls } = body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        { error: 'URLs array is required' },
        { status: 400 }
      );
    }

    if (!INDEXNOW_KEY) {
      return NextResponse.json(
        { error: 'INDEXNOW_KEY is not configured' },
        { status: 500 }
      );
    }

    // Convert relative URLs to absolute URLs if needed
    const absoluteUrls = urls.map((url: string) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
      }
      return `${BASE_URL}${url.startsWith('/') ? url : `/${url}`}`;
    });

    // IndexNow accepts up to 10,000 URLs per request
    const chunks: string[][] = [];
    for (let i = 0; i < absoluteUrls.length; i += 10000) {
      chunks.push(absoluteUrls.slice(i, i + 10000));
    }

    const results = await Promise.all(
      chunks.map(async (chunk) => {
        const payload = {
          host: new URL(BASE_URL).hostname,
          key: INDEXNOW_KEY,
          keyLocation: `${BASE_URL}/${INDEXNOW_KEY}.txt`,
          urlList: chunk,
        };

        try {
          const response = await fetch(INDEXNOW_ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          });

          return {
            success: response.ok,
            status: response.status,
            urlsCount: chunk.length,
          };
        } catch (error) {
          console.error('IndexNow submission error:', error);
          return {
            success: false,
            status: 500,
            error: error instanceof Error ? error.message : 'Unknown error',
            urlsCount: chunk.length,
          };
        }
      })
    );

    const allSuccessful = results.every((r) => r.success);

    return NextResponse.json({
      success: allSuccessful,
      results,
      totalUrls: absoluteUrls.length,
    });
  } catch (error) {
    console.error('IndexNow API error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'IndexNow API endpoint. Use POST to submit URLs.',
    method: 'POST',
    body: { urls: ['array of URLs to submit'] },
  });
}
