import * as admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

if (!serviceAccountPath) {
  console.warn('FIREBASE_SERVICE_ACCOUNT_PATH not set - Firebase Admin may not initialize correctly');
}

function initializeFirebaseAdmin() {
  // Check if Firebase Admin is already initialized
  if (admin.apps.length > 0) {
    return admin.apps[0]!;
  }

  try {
    let serviceAccount: any = null;
    
    // Priority 1: Service Account JSON File
    if (serviceAccountPath) {
      const fullPath = path.isAbsolute(serviceAccountPath) 
        ? serviceAccountPath 
        : path.resolve(process.cwd(), serviceAccountPath);
      
      if (fs.existsSync(fullPath)) {
        const fileContent = fs.readFileSync(fullPath, 'utf8');
        serviceAccount = JSON.parse(fileContent);
      }
    }

    // Priority 2: Service Account JSON String Env
    if (!serviceAccount && process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        try {
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        } catch (e: any) {
            console.error('[Firebase Admin] Error parsing JSON env var:', e.message);
        }
    }

    // Priority 3: Individual Env Vars (Professional/Cloud Standard approach)
    if (!serviceAccount && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
        serviceAccount = {
            project_id: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
            client_email: process.env.FIREBASE_CLIENT_EMAIL,
            private_key: process.env.FIREBASE_PRIVATE_KEY
        };
    }

    if (serviceAccount) {
      // Ensure private key has correct newline characters if they were escaped
      if (typeof serviceAccount.private_key === 'string' && serviceAccount.private_key.includes('\\n')) {
          serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }

      console.log(`[Firebase Admin] Initializing for project: ${serviceAccount.project_id}`);
      return admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
      });
    } else {
        const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
        console.warn(`[Firebase Admin] CRITICAL: No full credentials found. Authentication will likely fail.`);
        return admin.initializeApp({
            projectId: projectId
        });
    }
  } catch (error: any) {
    console.error('[Firebase Admin] Initialization Failed:', error.message);
    throw error;
  }
}


const adminApp = initializeFirebaseAdmin();
const adminAuth = admin.auth(adminApp);

export { adminApp, adminAuth };
