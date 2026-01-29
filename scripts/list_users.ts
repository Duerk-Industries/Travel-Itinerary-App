import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getEnvValue } from '../server/src/env';
import { loadEnv } from '../server/src/env_loader';

// Load environment variables from server/.env only
loadEnv({ serverOnly: true });

const listUsers = async () => {
  const projectId = getEnvValue('GCLOUD_PROJECT_ID');
  const clientEmail = getEnvValue('FIREBASE_CLIENT_EMAIL');
  const privateKey = getEnvValue('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

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
