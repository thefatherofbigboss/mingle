import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseClient';
import { adminAuth } from '@/lib/firebase-admin';
import { v5 as uuidv5 } from 'uuid';
import { SM_UUID_NAMESPACE } from '@/lib/userProfile';
import { sendEmail, generateMembershipVerificationHtml } from '@/lib/email';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: NextRequest) {
    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
        }

        const idToken = authHeader.split('Bearer ')[1];
        let email: string | undefined;
        let mappedUserId: string;

        try {
            const decoded = await adminAuth.verifyIdToken(idToken);
            mappedUserId = uuidv5(decoded.uid, SM_UUID_NAMESPACE);
            email = decoded.email?.toLowerCase();
            if (!email && (decoded as { firebase?: { identities?: { email?: string[] } } }).firebase?.identities?.email) {
                const identities = (decoded as { firebase?: { identities?: { email?: string[] } } }).firebase?.identities;
                email = identities?.email?.[0]?.toLowerCase();
            }
            if (!email) {
                const userRecord = await adminAuth.getUser(decoded.uid);
                email = userRecord.email?.toLowerCase();
            }
        } catch {
            return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
        }

        if (!email) {
            return NextResponse.json({ error: 'Email not found on account' }, { status: 400 });
        }
        const supabase = createAdminClient();

        const { data: subscription } = await supabase
            .from('user_subscriptions')
            .select('*')
            .or(`customer_email.eq.${email},user_id.eq.${mappedUserId}`)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!subscription) {
            return NextResponse.json({ error: 'No active membership found for this account' }, { status: 404 });
        }

        if (subscription.is_verified) {
            return NextResponse.json({ success: true, message: 'Email already verified' });
        }

        const verificationToken = subscription.verification_token || uuidv4();

        if (!subscription.verification_token) {
            await supabase
                .from('user_subscriptions')
                .update({ verification_token: verificationToken, updated_at: new Date().toISOString() })
                .eq('id', subscription.id);
        }

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.strangermingle.com';
        const verificationLink = `${appUrl}/verify-membership?token=${verificationToken}`;

        await sendEmail({
            to: email,
            subject: 'Verify Your Stranger Mingle Membership',
            html: generateMembershipVerificationHtml(subscription.customer_name || 'Premium Member', verificationLink),
            from: 'Stranger Mingle <team@strangermingle.com>',
        });

        return NextResponse.json({ success: true, message: 'Verification email sent' });
    } catch (error: unknown) {
        console.error('[ResendVerification] Error:', error);
        const message = error instanceof Error ? error.message : 'Failed to send verification email';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
