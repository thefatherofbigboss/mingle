import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const OTP_SECRET = process.env.INTERNAL_API_SECRET || 'fallback_secret_xyz'; // Defined in .env.local

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { email, otp, hash, expiresAt } = body;

        if (!email || !otp || !hash || typeof expiresAt !== 'number') {
            return NextResponse.json({ success: false, error: 'Missing verification fields' }, { status: 400 });
        }

        // 1. Check expiration
        if (Date.now() > expiresAt) {
            return NextResponse.json({ success: false, error: 'OTP has expired. Please request a new one.' }, { status: 400 });
        }

        // 2. Validate hash
        const payload = `${email}:${otp}:${expiresAt}`;
        const computedHash = crypto
            .createHmac('sha256', OTP_SECRET)
            .update(payload)
            .digest('hex');

        if (computedHash === hash) {
            return NextResponse.json({ success: true, message: 'Email verified' });
        } else {
            return NextResponse.json({ success: false, error: 'Invalid OTP' }, { status: 401 });
        }

    } catch (error: any) {
        console.error('Verify OTP Error:', error);
        return NextResponse.json({
            error: error?.message || 'Internal error while verifying OTP'
        }, { status: 500 });
    }
}
