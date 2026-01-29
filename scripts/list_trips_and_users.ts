import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import { getEnvValue } from '../server/src/env';
import { loadEnv } from '../server/src/env_loader';

// Load environment variables from .env files
loadEnv();
const listTripsAndUsers = async () => {
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
    const tripsSnapshot = await db.collection('trips').get();

    if (tripsSnapshot.empty) {
      console.log('No trips found.');
      return;
    }

    console.log('Trips and Associated Users:');

    for (const tripDoc of tripsSnapshot.docs) {
      const trip = tripDoc.data();
      console.log(`\n- Trip: ${trip.name} (ID: ${tripDoc.id})`);

      const groupMembersSnapshot = await db.collection('group_members').where('groupId', '==', trip.groupId).get();

      if (groupMembersSnapshot.empty) {
        console.log('  No users associated with this trip.');
        continue;
      }

      const userIds = groupMembersSnapshot.docs.map(doc => doc.data().userId).filter(Boolean);

      if (userIds.length === 0) {
        console.log('  No registered users associated with this trip (only guest members may exist).');
        continue;
      }

      const usersSnapshot = await db.collection('users').where(FieldPath.documentId(), 'in', userIds).get();
      
      if (usersSnapshot.empty) {
        console.log('  Could not find user details for associated members.');
        continue;
      }

      usersSnapshot.forEach(userDoc => {
        const user = userDoc.data();
        console.log(`  - User: ${user.email} (ID: ${userDoc.id})`);
      });
    }
  } catch (error) {
    console.error('Error listing trips and users:', error);
  }
};

listTripsAndUsers();
