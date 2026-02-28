import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as env from '../server/src/env.ts';
import * as envLoader from '../server/src/env_loader.ts';

const envApi = ((env as any).default ?? env) as any;
const envLoaderApi = ((envLoader as any).default ?? envLoader) as any;

// Load environment variables from server/.env only
envLoaderApi.loadEnv({ serverOnly: true });

const listUsers = async () => {
  const projectId = envApi.getEnvValue('GCLOUD_PROJECT_ID');
  const clientEmail = envApi.getEnvValue('FIREBASE_CLIENT_EMAIL');
  const privateKey = envApi.getEnvValue('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    console.error('Missing required environment variables for Firebase Admin SDK');
    process.exit(1);
  }

  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });

  const db = getFirestore();

  try {
    const usersSnapshot = await db.collection('users').get();
    if (usersSnapshot.empty) {
      console.log('No users found.');
      return;
    }

    console.log('App Users:');
    usersSnapshot.forEach(doc => {
      const user = doc.data();
      console.log(`- User ID: ${doc.id}, Email: ${user.email}, Provider: ${user.provider}`);
    });
  } catch (error) {
    console.error('Error listing users:', error);
  }
};

listUsers();
