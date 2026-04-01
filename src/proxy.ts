import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const ALLOWED_DOMAIN = 'www.strangermingle.com';
const ALLOWED_DOMAIN_WITHOUT_WWW = 'strangermingle.com';

export function proxy(request: NextRequest) {
    const url = request.nextUrl;
    const hostname = request.headers.get('host') || '';
    
    // Allow localhost for development
    const isLocalhost = hostname.includes('localhost') || hostname.includes('127.0.0.1') || hostname.includes('0.0.0.0');
    if (isLocalhost) {
        return NextResponse.next();
    }
    
    // Get the actual hostname (remove port if present)
    const host = hostname.split(':')[0];
    
    // Redirect non-www to www
    if (host === ALLOWED_DOMAIN_WITHOUT_WWW) {
        const urlWithWww = url.clone();
        urlWithWww.host = ALLOWED_DOMAIN;
        return NextResponse.redirect(urlWithWww);
    }
    
    // Block any other domains
    if (host !== ALLOWED_DOMAIN) {
        return new NextResponse('503 Service Unavailable\nThe server is temporarily unable to handle your request due to maintenance or capacity issues.\n\nPlease try again later.', {
            status: 403,
            headers: {
                'Content-Type': 'text/plain',
            },
        });
    }
    
    // Force HTTPS in production (Vercel handles this automatically, but adding as extra check)
    if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
        const httpsUrl = url.clone();
        httpsUrl.protocol = 'https:';
        return NextResponse.redirect(httpsUrl);
    }
    
    return NextResponse.next();
}

export const config = {
    matcher: '/:path*',
}
