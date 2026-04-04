import { NextResponse } from 'next/server';
import * as libFunctions from '@/lib';
import { adminAuth } from '@/lib/firebase-admin';
import { v5 as uuidv5 } from 'uuid';
import { SM_UUID_NAMESPACE } from '@/lib';

/**
 * Backend RPC Gateway
 * -------------------
 * This route allows the frontend to call backend service functions securely.
 * 
 * Security Measures:
 * 1. Internal API Secret check (Custom Header)
 * 2. Firebase ID Token Verification (Authorization Header)
 * 3. Identity Bridging: Firebase UID -> Deterministic Supabase UUID
 */

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

export async function POST(req: Request) {
  try {
    // 1. Security Check: Validate Secret Header
    const secretHeader = req.headers.get('x-internal-api-secret');
    if (secretHeader !== INTERNAL_API_SECRET) {
      console.warn('[RPC] Unauthorized Access Attempt: Invalid Secret');
      return NextResponse.json({ error: 'Unauthorized Internal Request' }, { status: 401 });
    }

    // 2. Authentication Context
    const bearerHeader = req.headers.get('Authorization');
    let authenticatedUserUid = null;
    let mappedUserId = null;

    if (bearerHeader && bearerHeader.startsWith('Bearer ')) {
      const idToken = bearerHeader.split('Bearer ')[1];
      try {
        const decodedToken = await adminAuth.verifyIdToken(idToken);
        authenticatedUserUid = decodedToken.uid;
        // Map Firebase 'uid' string to a Supabase-compatible UUID
        mappedUserId = uuidv5(authenticatedUserUid, SM_UUID_NAMESPACE);
        console.log(`[RPC] User authenticated: ${authenticatedUserUid} (Mapped UUID: ${mappedUserId})`);

        // AUTO-SYNC: Ensure the corresponding record exists in Supabase public.users
        // This is non-blocking but essential for initial sign-ups
        const { syncFirebaseUser } = await import('@/lib/userProfile');
        await syncFirebaseUser({
            uid: authenticatedUserUid,
            email: decodedToken.email,
            displayName: decodedToken.name, // Firebase 'name' claims
            phoneNumber: decodedToken.phone_number,
            mappedUserId: mappedUserId,
            provider: decodedToken.firebase?.sign_in_provider
        });

      } catch (e: any) {
        console.warn('[RPC] Firebase Token verification failed:', e.message);
        if (e.code === 'auth/invalid-app-credential') {
          console.error('[RPC] FATAL: Firebase Admin SDK is improperly initialized. Check your service account and private key.');
        }
      }
    }

    // 3. Request Parsing
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return NextResponse.json({ error: 'Invalid Request Body' }, { status: 400 });
    }

    const { functionName, args = [] } = body;

    // 4. Function Resolution
    const fn = (libFunctions as any)[functionName];

    if (!fn || typeof fn !== 'function') {
      console.error(`[RPC] Method not found: ${functionName}`);
      return NextResponse.json({ error: `Function '${functionName}' not allowed or not found` }, { status: 404 });
    }

    /**
     * 5. Security: Verified Argument Injection
     * ---------------------------------------
     * We don't trust the 'args' provided by the frontend for identity.
     * If the function expects a 'userId' or 'user_id', we inject the verified mappedUserId.
     */
    const processedArgs = [...(args || [])];
    
    // Simple heuristic: if the function is not for blog/authors (public) 
    // and we have a mappedUserId, we should check if we need to inject it.
    // For specific interaction functions, we'll be explicit.
    
    const authenticatedFunctions = [
        'getUserProfileByUserId', 'updateUserProfile', 'getUserSubscription',
        'createGroup', 'joinGroup', 'leaveGroup', 'getUserGroups',
        'createLocation', 'createCategory', 'updateGroup', 'getGroup', 'getGroups', 'uploadGroupImage',
        'getConversations', 'getMessages', 'sendMessage', 'startConversation', 'getAvailableMembers'
    ];

    if (authenticatedFunctions.includes(functionName)) {
        if (!mappedUserId) {
            console.error(`[RPC] Blocking unauthenticated call to ${functionName}`);
            return NextResponse.json({ error: 'This action requires authentication' }, { status: 401 });
        }
        
        // Find the index of the userId argument. 
        if (functionName === 'submitEventReview') {
            // reviewData is usually args[0]
            if (processedArgs[0] && typeof processedArgs[0] === 'object') {
                processedArgs[0].user_id = mappedUserId;
            }
        } else if (['getUserProfileByUserId', 'updateUserProfile', 'getUserSubscription', 'createGroup', 'joinGroup', 'leaveGroup', 'getUserGroups', 'updateGroup', 'uploadGroupImage', 'getGroup', 'getGroups', 'getConversations', 'getAvailableMembers'].includes(functionName)) {
            processedArgs[0] = mappedUserId;
        } else if (functionName === 'getMessages') {
            // (conversationId, userId)
            processedArgs[1] = mappedUserId;
        } else if (functionName === 'sendMessage') {
            // (conversationId, userId, content)
            processedArgs[0] = args[0];
            processedArgs[1] = mappedUserId;
            processedArgs[2] = args[1];
        } else if (functionName === 'startConversation') {
            // (userId, targetUserId)
            processedArgs[0] = mappedUserId;
            processedArgs[1] = args[0];
        } else if (functionName === 'createOrUpdateUserProfile') {
            if (processedArgs[0] && typeof processedArgs[0] === 'object') {
                processedArgs[0].user_id = mappedUserId;
            }
        } else {
            // General case: (eventId, userId, ...) -> userId is index 1
            if (processedArgs.length >= 2) {
                processedArgs[1] = mappedUserId;
            } else if (processedArgs.length === 1) {
                // Some might have (userId) only
                processedArgs.push(mappedUserId);
            }
        }
    }

    // 6. Execution
    console.log(`[RPC] Executing ${functionName} with args:`, JSON.stringify(processedArgs));
    const result = await fn(...processedArgs);

    return NextResponse.json({ result });
  } catch (error: any) {
    console.error(`[RPC] Fatal Error in ${req.url}:`, error);
    return NextResponse.json({ 
      error: 'Internal Server Error', 
      message: error.message 
    }, { status: 500 });
  }
}
