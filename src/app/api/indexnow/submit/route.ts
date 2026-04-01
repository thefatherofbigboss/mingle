import { NextResponse } from 'next/server';
import { fetchAllSitemapUrls, submitToIndexNow } from '@/lib/indexnow';

// Force dynamic rendering to prevent caching
export const dynamic = 'force-dynamic';

/**
 * POST /api/indexnow/submit
 * Submits all sitemap URLs to IndexNow for instant indexing
 */
export async function POST(_request: Request) {
    try {
        // Optional: Add authentication check
        // const authHeader = request.headers.get('authorization');
        // const expectedSecret = process.env.INDEXNOW_SUBMIT_SECRET;
        // if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
        //   return NextResponse.json(
        //     { error: 'Unauthorized' },
        //     { status: 401 }
        //   );
        // }

        // console.log('Fetching sitemap URLs...');
        const urls = await fetchAllSitemapUrls();

        if (urls.length === 0) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'No URLs found in sitemaps',
                },
                { status: 400 }
            );
        }

        // console.log(`Found ${urls.length} URLs to submit to IndexNow`);

        // Submit to IndexNow
        const result = await submitToIndexNow(urls);

        if (!result.success) {
            return NextResponse.json(
                {
                    success: false,
                    error: result.message,
                    status: result.status,
                },
                { status: result.status }
            );
        }

        return NextResponse.json({
            success: true,
            message: result.message,
            totalUrls: result.submittedCount,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('Error in IndexNow submission:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred',
            },
            { status: 500 }
        );
    }
}

/**
 * GET /api/indexnow/submit
 * Returns information about the endpoint
 */
export async function GET() {
    return NextResponse.json({
        endpoint: '/api/indexnow/submit',
        method: 'POST',
        description: 'Submit all sitemap URLs to IndexNow for instant search engine indexing',
        usage: 'Send a POST request to this endpoint to trigger IndexNow submission',
        note: 'This endpoint fetches URLs from /sitemap.xml and /sitemap-events.xml',
    });
}
