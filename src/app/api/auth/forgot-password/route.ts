import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { sendEmail, generatePasswordResetHtml } from '@/lib/email';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*', // Allow all domains for this public endpoint
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return NextResponse.json({}, { headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
    try {
        const { email } = await req.json();

        if (!email) {
            return NextResponse.json({ error: 'Email is required' }, { headers: CORS_HEADERS, status: 400 });
        }

        const cleanEmail = email.trim().toLowerCase();

        // 1. Check if user exists (to prevent abuse, we might skip this or handle it gracefully)
        try {
            const user = await adminAuth.getUserByEmail(cleanEmail);
            
            // 2. Generate a localized reset link
            // Use the environment's host or hardcoded production domain
            const host = process.env.NEXT_PUBLIC_APP_URL || 'https://www.strangermingle.com';
            const actionCodeSettings = {
                url: `${host}/reset-password`,
                handleCodeInApp: true,
            };

            const link = await adminAuth.generatePasswordResetLink(cleanEmail, actionCodeSettings);

            // 3. Extract the oobCode from the Firebase link to create a direct brand link
            // The link looks like: https://<domain>/__/auth/action?apiKey=...&oobCode=XYZ...
            const urlObj = new URL(link);
            const oobCode = urlObj.searchParams.get('oobCode');
            const directLink = `${host}/reset-password?oobCode=${oobCode}`;

            // 4. Generate HTML and send via Resend
            const html = generatePasswordResetHtml(directLink);
            await sendEmail({
                to: cleanEmail,
                subject: 'Reset Your Stranger Mingle Password',
                html,
            });

            console.log(`[Auth] Custom reset email sent to ${cleanEmail}. Direct Link: ${directLink}`);
            
            return NextResponse.json(
                { success: true, message: 'Password reset link sent successfully' },
                { headers: CORS_HEADERS }
            );

        } catch (err: any) {
            // If user doesn't exist, we still return success to prevent email enumeration attacks
            if (err.code === 'auth/user-not-found') {
                console.warn(`[Auth] Password reset requested for non-existent email: ${cleanEmail}`);
                return NextResponse.json(
                    { success: true, message: 'Password reset link sent successfully' },
                    { headers: CORS_HEADERS }
                );
            }
            throw err;
        }

    } catch (error: any) {
        console.error('[Auth] Custom Forgot Password Error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to process password reset request' },
            { headers: CORS_HEADERS, status: 500 }
        );
    }
}
