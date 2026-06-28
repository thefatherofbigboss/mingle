import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { syncFirebaseUser, SM_UUID_NAMESPACE } from '@/lib/userProfile';
import { v5 as uuidv5 } from 'uuid';

export async function POST(req: Request) {
  try {
    const bearerHeader = req.headers.get('Authorization');
    
    if (!bearerHeader || !bearerHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    const idToken = bearerHeader.split('Bearer ')[1];
    
    try {
      // 1. Verify the Firebase ID Token
      const decodedToken = await adminAuth.verifyIdToken(idToken);
      const uid = decodedToken.uid;
      
      // 2. Map Firebase UID to Deterministic Supabase UUID
      const mappedUserId = uuidv5(uid, SM_UUID_NAMESPACE);
      
      console.log(`[AuthSync] Syncing user ${uid} (Mapped: ${mappedUserId})`);

      // 3. Sync User Profile in Database
      const user = await syncFirebaseUser({
          uid: uid,
          email: decodedToken.email,
          displayName: decodedToken.name,
          phoneNumber: decodedToken.phone_number,
          mappedUserId: mappedUserId,
          provider: decodedToken.firebase?.sign_in_provider
      });

      return NextResponse.json({ 
        success: true, 
        message: 'User synced successfully',
        user: user 
      });

    } catch (e: any) {
      console.error('[AuthSync] Token verification or sync failed:', e.message);
      return NextResponse.json({ error: 'Invalid token or sync failed' }, { status: 401 });
    }

  } catch (error: any) {
    console.error('[AuthSync] Internal server error:', error.message);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
