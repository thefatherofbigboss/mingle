import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { syncFirebaseUser, SM_UUID_NAMESPACE } from '@/lib/userProfile';
import { v5 as uuidv5 } from 'uuid';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return NextResponse.json({}, { headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { action, email, password } = body;

        // Action 1: Check which sign-in providers exist for an email
        if (action === 'check-providers') {
            if (!email) {
                return NextResponse.json({ error: 'Email is required' }, { headers: CORS_HEADERS, status: 400 });
            }
            const cleanEmail = email.trim().toLowerCase();
            try {
                const user = await adminAuth.getUserByEmail(cleanEmail);
                const providers = user.providerData.map(p => p.providerId);
                const hasPassword = providers.includes('password') || !!user.passwordHash;
                const hasGoogle = providers.includes('google.com');

                return NextResponse.json({
                    success: true,
                    exists: true,
                    providers: providers,
                    hasPassword,
                    hasGoogle,
                    uid: user.uid
                }, { headers: CORS_HEADERS });
            } catch (err: any) {
                if (err.code === 'auth/user-not-found') {
                    return NextResponse.json({
                        success: true,
                        exists: false,
                        providers: [],
                        hasPassword: false,
                        hasGoogle: false
                    }, { headers: CORS_HEADERS });
                }
                throw err;
            }
        }

        // Action 2: Attach a password to an existing account (e.g. created via Google)
        if (action === 'attach-password') {
            if (!email || !password) {
                return NextResponse.json({ error: 'Email and password are required' }, { headers: CORS_HEADERS, status: 400 });
            }
            if (password.length < 6) {
                return NextResponse.json({ error: 'Password must be at least 6 characters' }, { headers: CORS_HEADERS, status: 400 });
            }

            const cleanEmail = email.trim().toLowerCase();

            // Verify authorization if Bearer token present
            const authHeader = req.headers.get('Authorization');
            let tokenEmail: string | null = null;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                try {
                    const decoded = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
                    tokenEmail = decoded.email?.toLowerCase() || null;
                } catch (e) {
                    console.warn('[LinkAccount] Token verification warning:', e);
                }
            }

            try {
                const user = await adminAuth.getUserByEmail(cleanEmail);

                // If token provided, ensure it matches
                if (tokenEmail && tokenEmail !== cleanEmail) {
                    return NextResponse.json({ error: 'Unauthorized to set password for this email' }, { headers: CORS_HEADERS, status: 403 });
                }

                // Update user with password in Firebase Auth
                await adminAuth.updateUser(user.uid, { password: password });
                console.log(`[LinkAccount] Password attached to user ${user.uid} (${cleanEmail})`);

                // Ensure Supabase sync
                const mappedUserId = uuidv5(user.uid, SM_UUID_NAMESPACE);
                await syncFirebaseUser({
                    uid: user.uid,
                    email: cleanEmail,
                    displayName: user.displayName,
                    phoneNumber: user.phoneNumber,
                    mappedUserId: mappedUserId,
                    provider: 'password'
                });

                return NextResponse.json({
                    success: true,
                    message: 'Password set successfully. You can now log in with either Google or password.',
                    uid: user.uid
                }, { headers: CORS_HEADERS });

            } catch (err: any) {
                console.error('[LinkAccount] Error attaching password:', err);
                return NextResponse.json({ error: err.message || 'Failed to attach password' }, { headers: CORS_HEADERS, status: 500 });
            }
        }

        // Action 3: Handle seamless login when Google sign-in encounters existing password account
        if (action === 'google-seamless-login') {
            const { idToken } = body;
            if (!idToken) {
                return NextResponse.json({ error: 'idToken is required' }, { headers: CORS_HEADERS, status: 400 });
            }

            try {
                let googleEmail: string | undefined;
                let displayName: string | undefined;
                let phoneNumber: string | undefined;

                // Try Firebase verifyIdToken first
                try {
                    const decoded = await adminAuth.verifyIdToken(idToken);
                    googleEmail = decoded.email?.toLowerCase();
                    displayName = decoded.name;
                    phoneNumber = decoded.phone_number;
                } catch (tokenErr) {
                    // Fall back to Google OAuth tokeninfo endpoint
                    const gRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
                    if (gRes.ok) {
                        const gData = await gRes.json();
                        if (gData.email_verified === 'true' || gData.email_verified === true) {
                            googleEmail = gData.email?.toLowerCase();
                            displayName = gData.name;
                        }
                    }
                }
                
                if (!googleEmail) {
                    return NextResponse.json({ error: 'Invalid or unverified Google token' }, { headers: CORS_HEADERS, status: 400 });
                }

                // Look up canonical user in Firebase Auth
                const canonicalUser = await adminAuth.getUserByEmail(googleEmail);
                
                // Create a custom token for the canonical user so client signs into the exact canonical account
                const customToken = await adminAuth.createCustomToken(canonicalUser.uid);
                
                // Ensure Supabase user profile sync
                const mappedUserId = uuidv5(canonicalUser.uid, SM_UUID_NAMESPACE);
                await syncFirebaseUser({
                    uid: canonicalUser.uid,
                    email: googleEmail,
                    displayName: displayName || canonicalUser.displayName,
                    phoneNumber: phoneNumber || canonicalUser.phoneNumber,
                    mappedUserId: mappedUserId,
                    provider: 'google.com'
                });

                return NextResponse.json({
                    success: true,
                    customToken,
                    uid: canonicalUser.uid,
                    mappedUserId
                }, { headers: CORS_HEADERS });

            } catch (err: any) {
                console.error('[LinkAccount] Seamless Google login failed:', err);
                return NextResponse.json({ error: err.message || 'Seamless login failed' }, { headers: CORS_HEADERS, status: 500 });
            }
        }

        return NextResponse.json({ error: 'Invalid action' }, { headers: CORS_HEADERS, status: 400 });

    } catch (error: any) {
        console.error('[LinkAccount] Internal Server Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { headers: CORS_HEADERS, status: 500 });
    }
}
