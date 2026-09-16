import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getCorsHeaders } from '@/lib/cors';

const ALLOWED_DOMAIN = 'api.strangermingle.com';
const MAIN_SITE_DOMAIN = 'www.strangermingle.com';

export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const hostname = request.headers.get('host') || '';

  // Intercept CORS preflight OPTIONS requests for all /api routes
  if (url.pathname.startsWith('/api') && request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 200,
      headers: getCorsHeaders(request),
    });
  }

  // Allow localhost for local development
  const isLocalhost =
    hostname.includes('localhost') ||
    hostname.includes('127.0.0.1') ||
    hostname.includes('0.0.0.0');

  if (isLocalhost) {
    const res = NextResponse.next();
    if (url.pathname.startsWith('/api')) {
      const cors = getCorsHeaders(request);
      Object.entries(cors).forEach(([key, val]) => res.headers.set(key, val));
    }
    return res;
  }

  // Get actual hostname without port
  const host = hostname.split(':')[0];

  // Redirect root domain to main website
  if (host === MAIN_SITE_DOMAIN || host === 'strangermingle.com') {
    return NextResponse.redirect('https://' + MAIN_SITE_DOMAIN + url.pathname + url.search);
  }

  // Allow only api.strangermingle.com in production
  if (host !== ALLOWED_DOMAIN && !isLocalhost) {
    return new NextResponse('Backend is running successfully', {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // Force HTTPS in production
  if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    const httpsUrl = url.clone();
    httpsUrl.protocol = 'https:';
    return NextResponse.redirect(httpsUrl);
  }

  const res = NextResponse.next();
  if (url.pathname.startsWith('/api')) {
    const cors = getCorsHeaders(request);
    Object.entries(cors).forEach(([key, val]) => res.headers.set(key, val));
  }
  return res;
}

export const config = {
  matcher: ['/:path*'],
};
