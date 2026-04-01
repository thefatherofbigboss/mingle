/// <reference types="node" />
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const ALLOWED_DOMAIN = 'api.strangermingle.com';
const MAIN_SITE_DOMAIN = 'www.strangermingle.com';

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

    // Redirect main site or root domain to the main website if accessed via backend URL
    if (host === MAIN_SITE_DOMAIN || host === 'strangermingle.com') {
        return NextResponse.redirect('https://' + MAIN_SITE_DOMAIN + url.pathname + url.search);
    }

    // Block any other domains to prevent unauthorized proxying or access
    // This allows api.strangermingle.com and localhost
    if (host !== ALLOWED_DOMAIN && !isLocalhost) {
        return new NextResponse('Backend is running successfully', {
            status: 403,
            headers: {
                'Content-Type': 'text/plain',
            },
        });
    }

    // Force HTTPS in production
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
