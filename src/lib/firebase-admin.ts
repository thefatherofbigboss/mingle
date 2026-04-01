import * as admin from 'firebase-admin';
import { getApps } from 'firebase-admin/app';
import fs from 'fs';
import path from 'path';

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

if (!serviceAccountPath) {
  console.warn('FIREBASE_SERVICE_ACCOUNT_PATH not set - Firebase Admin may not initialize correctly');
}

function initializeFirebaseAdmin() {
  const existingApps = getApps();
  if (existingApps.length > 0) {
    const existingApp = admin.app();
    // Check if the existing app has a project ID (it should have one if correctly initialized with cert)
    // In some cases, a default empty app might be present.
    if ((existingApp.options as any).projectId || (existingApp.options.credential as any)?.projectId) {
      return existingApp;
    }
    console.warn('[Firebase Admin] Found existing app but it appears uncredentialed. Re-initializing...');
  }

  console.log('[Firebase Admin] Starting initialization...');
  
  try {
    let serviceAccount: any = null;
    
    if (serviceAccountPath) {
      const fullPath = path.isAbsolute(serviceAccountPath) 
        ? serviceAccountPath 
        : path.resolve(process.cwd(), serviceAccountPath);
      
      if (fs.existsSync(fullPath)) {
        console.log('[Firebase Admin] Loading service account from:', fullPath);
        const fileContent = fs.readFileSync(fullPath, 'utf8');
        serviceAccount = JSON.parse(fileContent);
      }
    }

    if (!serviceAccount && process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        try {
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        } catch (e: any) {
            console.error('[Firebase Admin] Error parsing JSON env var:', e.message);
        }
    }

    if (serviceAccount) {
      // STRICT VALIDATION
      if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
          throw new Error('Service account object is missing required fields (project_id, private_key, client_email)');
      }

      // Ensure private key has correct newline characters if they were escaped
      if (typeof serviceAccount.private_key === 'string' && serviceAccount.private_key.includes('\\n')) {
          serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }

      return admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
      });
    } else {
        console.warn('[Firebase Admin] No service account found. Falling back to default credentials.');
        return admin.initializeApp();
    }
  } catch (error: any) {
    console.error('[Firebase Admin] Initialization Failed:', error.message);
    throw error;
  }
}


const adminApp = initializeFirebaseAdmin();
const adminAuth = admin.auth(adminApp);

export { adminApp, adminAuth };
