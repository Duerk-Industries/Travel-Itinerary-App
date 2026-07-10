import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import * as env from '../server/src/env.ts';
import * as envLoader from '../server/src/env_loader.ts';

const envApi = ((env as any).default ?? env) as any;
const envLoaderApi = ((envLoader as any).default ?? envLoader) as any;

// Load environment variables from server/.env only
envLoaderApi.loadEnv({ serverOnly: true });

const listUsers = async () => {
  const projectId =
    envApi.getEnvValue('GCLOUD_PROJECT_ID') ||
    envApi.getEnvValue('FIREBASE_PROJECT_ID') ||
    envApi.getEnvValue('GOOGLE_CLOUD_PROJECT');
  const clientEmail = envApi.getEnvValue('FIREBASE_CLIENT_EMAIL');
  const privateKey = envApi.getEnvValue('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n');
  const databaseId = envApi.getEnvValue('FIRESTORE_DATABASE_ID');
  const emailArgIndex = process.argv.findIndex((arg) => arg === '--email');
  const emailFilter = emailArgIndex >= 0 ? process.argv[emailArgIndex + 1]?.trim().toLowerCase() : '';
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!projectId) {
    console.error('Missing GCLOUD_PROJECT_ID, FIREBASE_PROJECT_ID, or GOOGLE_CLOUD_PROJECT.');
    process.exit(1);
  }

  if (!clientEmail && !privateKey && credentialsPath) {
    const resolvedPath = path.resolve(credentialsPath);
    if (!fs.existsSync(resolvedPath)) {
      console.warn(`Ignoring missing GOOGLE_APPLICATION_CREDENTIALS file for local lookup: ${credentialsPath}`);
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
  }

  const app = initializeApp(
    clientEmail && privateKey
      ? { credential: cert({ projectId, clientEmail, privateKey }) }
      : { projectId, credential: applicationDefault() }
  );

  const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);

  try {
    const usersSnapshot = emailFilter
      ? await db.collection('users').where('email', '==', emailFilter).limit(10).get()
      : await db.collection('users').get();
    if (usersSnapshot.empty) {
      if (emailFilter) {
        const profileSnapshot = await db.collection('web_users').where('email', '==', emailFilter).limit(10).get();
        if (!profileSnapshot.empty) {
          console.log(`App Users matching ${emailFilter}:`);
          profileSnapshot.forEach(doc => {
            const user = doc.data();
            console.log(`- User ID: ${doc.id}, Email: ${user.email}, Source: web_users`);
          });
          return;
        }
      }
      console.log(emailFilter ? `No users found for ${emailFilter}.` : 'No users found.');
      return;
    }

    console.log(emailFilter ? `App Users matching ${emailFilter}:` : 'App Users:');
    usersSnapshot.forEach(doc => {
      const user = doc.data();
      console.log(`- User ID: ${doc.id}, Email: ${user.email}, Provider: ${user.provider}`);
    });
  } catch (error) {
    console.error('Error listing users:', error);
  }
};

listUsers();
