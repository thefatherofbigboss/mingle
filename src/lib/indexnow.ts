/**
 * Server-side utility functions for IndexNow URL submission
 */

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.strangermingle.com';
const INDEXNOW_API_KEY = process.env.INDEXNOW_KEY;
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

/**
 * Fetch all URLs from the main sitemap and events sitemap
 */
export async function fetchAllSitemapUrls(): Promise<string[]> {
  const urls: string[] = [];

  try {
    // Fetch main sitemap
    const mainSitemapResponse = await fetch(`${BASE_URL}/sitemap.xml`);
    if (mainSitemapResponse.ok) {
      const mainSitemapText = await mainSitemapResponse.text();
      const mainUrls = extractUrlsFromXml(mainSitemapText);
      urls.push(...mainUrls);
    }

    // Fetch events sitemap
    const eventsSitemapResponse = await fetch(`${BASE_URL}/sitemap-events.xml`);
    if (eventsSitemapResponse.ok) {
      const eventsSitemapText = await eventsSitemapResponse.text();
      const eventUrls = extractUrlsFromXml(eventsSitemapText);
      urls.push(...eventUrls);
    }
  } catch (error) {
    console.error('Error fetching sitemap URLs:', error);
  }

  // Remove duplicates
  return [...new Set(urls)];
}

/**
 * Extract URLs from XML sitemap content
 */
function extractUrlsFromXml(xmlContent: string): string[] {
  const urls: string[] = [];
  const locRegex = /<loc>(.*?)<\/loc>/g;
  let match;

  while ((match = locRegex.exec(xmlContent)) !== null) {
    urls.push(match[1]);
  }

  return urls;
}

/**
 * Submit URLs directly to IndexNow API
 * @param urls - Array of URLs to submit (max 10,000)
 * @returns Response from IndexNow API
 */
export async function submitToIndexNow(urls: string[]): Promise<{
  success: boolean;
  status: number;
  message: string;
  submittedCount: number;
}> {
  if (!INDEXNOW_API_KEY) {
    return {
      success: false,
      status: 500,
      message: 'IndexNow API key not configured',
      submittedCount: 0,
    };
  }

  if (urls.length === 0) {
    return {
      success: false,
      status: 400,
      message: 'No URLs provided',
      submittedCount: 0,
    };
  }

  // IndexNow allows max 10,000 URLs per request
  const urlsToSubmit = urls.slice(0, 10000);

  try {
    const requestBody = {
      host: new URL(BASE_URL).hostname,
      key: INDEXNOW_API_KEY,
      keyLocation: `${BASE_URL}/${INDEXNOW_API_KEY}.txt`,
      urlList: urlsToSubmit,
    };

    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(requestBody),
    });

    const status = response.status;
    let message = '';

    switch (status) {
      case 200:
        message = 'URLs submitted successfully';
        break;
      case 202:
        message = 'URLs received and will be processed';
        break;
      case 400:
        message = 'Bad request - Invalid format';
        break;
      case 403:
        message = 'Forbidden - Key verification failed';
        break;
      case 422:
        message = 'Unprocessable entity - Invalid URLs';
        break;
      case 429:
        message = 'Too many requests - Rate limited';
        break;
      default:
        message = `Unexpected status code: ${status}`;
    }

    return {
      success: status === 200 || status === 202,
      status,
      message,
      submittedCount: urlsToSubmit.length,
    };
  } catch (error) {
    console.error('Error submitting to IndexNow:', error);
    return {
      success: false,
      status: 500,
      message: error instanceof Error ? error.message : 'Unknown error occurred',
      submittedCount: 0,
    };
  }
}

/**
 * Submit URLs in batches to IndexNow
 * Useful for very large sitemaps
 */
export async function submitToIndexNowInBatches(
  urls: string[],
  batchSize: number = 10000
): Promise<{
  success: boolean;
  totalSubmitted: number;
  batches: Array<{ success: boolean; count: number; message: string }>;
}> {
  const batches: Array<{ success: boolean; count: number; message: string }> = [];
  let totalSubmitted = 0;

  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const result = await submitToIndexNow(batch);

    batches.push({
      success: result.success,
      count: result.submittedCount,
      message: result.message,
    });

    if (result.success) {
      totalSubmitted += result.submittedCount;
    }

    // Add a small delay between batches to avoid rate limiting
    if (i + batchSize < urls.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return {
    success: batches.every((b) => b.success),
    totalSubmitted,
    batches,
  };
}
