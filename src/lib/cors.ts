import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/(www\.)?strangermingle\.com$/,
  /^https?:\/\/admin\.strangermingle\.com$/,
  /^https?:\/\/stranger-mingle\.(firebaseapp|web)\.app$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true; // Server-to-server or mobile apps without origin header
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

export function getCorsHeaders(req: NextRequest) {
  const origin = req.headers.get('origin');
  const allowedOrigin = origin && isOriginAllowed(origin) ? origin : (origin || '*');

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-internal-api-secret, X-Requested-With, Accept',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

export function handleOptionsResponse(req: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: getCorsHeaders(req),
  });
}
