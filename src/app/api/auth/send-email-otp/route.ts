import { NextRequest, NextResponse } from 'next/server';
import { getResend } from '@/lib/email';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const OTP_SECRET = process.env.INTERNAL_API_SECRET || 'fallback_secret_xyz'; // Defined in .env.local

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { email } = body;

        if (!email || !email.includes('@')) {
            return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Expiration: 10 minutes from now
        const expiresAt = Date.now() + 10 * 60 * 1000;
        
        // Payload to hash
        const payload = `${email}:${otp}:${expiresAt}`;
        
        const hash = crypto
            .createHmac('sha256', OTP_SECRET)
            .update(payload)
            .digest('hex');

        // Send Email
        const { error: emailError } = await getResend().emails.send({
            from: 'Stranger Mingle <team@strangermingle.com>',
            to: [email],
            subject: 'Your stranger mingle verification code',
            html: `
            <div style="font-family: sans-serif; max-w-md mx-auto p-4">
                <h2>Welcome to Stranger Mingle!</h2>
                <p>Your email verification code is:</p>
                <h1 style="letter-spacing: 0.25em; color: #d97706;">${otp}</h1>
                <p>This code expires in 10 minutes. Do not share it with anyone.</p>
            </div>
            `,
        });

        if (emailError) {
            console.error('Resend Error:', emailError);
            return NextResponse.json({ error: 'Failed to send OTP email' }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            expiresAt,
            hash
        });

    } catch (error: any) {
        console.error('Send OTP Error:', error);
        return NextResponse.json({
            error: error?.message || 'Internal error while sending OTP'
        }, { status: 500 });
    }
}
