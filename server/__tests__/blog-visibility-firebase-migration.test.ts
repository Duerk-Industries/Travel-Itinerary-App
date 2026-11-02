import { randomUUID } from 'crypto';
import { getCurrentDbProvider } from '../src/db';
import { getDb } from '../src/db.firebase';
import { migrateBlogVisibilityTestUsers } from '../src/blog/visibilityFirebase';

const firestoreTest = getCurrentDbProvider() === 'firebase' ? it : it.skip;
firestoreTest('migrates existing Firestore test accounts once and preserves subsequent privacy choices', async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !String(process.env.GCLOUD_PROJECT_ID).startsWith('demo-')) throw new Error('This migration test requires a demo Firestore emulator project');
  const db = getDb(), user = db.collection('users').doc(randomUUID()), blog = db.collection('trip_blogs').doc(randomUUID());
  const marker = db.collection('schema_migrations').doc('r1_blog_visibility');
  const later = db.collection('users').doc(randomUUID());
  try {
    await user.set({ blogDefaultPublic: false, dateOfBirth: null });
    await blog.set({ publicOptOut: true });
    await marker.delete();
    await migrateBlogVisibilityTestUsers();
    expect((await user.get()).data()).toMatchObject({ blogDefaultPublic: true, dateOfBirth: null, blogVisibilityV1Migrated: true });
    expect((await blog.get()).data()?.publicOptOut).toBe(false);
    await user.update({ blogDefaultPublic: false });
    await later.set({ blogDefaultPublic: false });
    await migrateBlogVisibilityTestUsers();
    expect((await user.get()).data()?.blogDefaultPublic).toBe(false);
    expect((await later.get()).data()?.blogDefaultPublic).toBe(false);
  } finally { await Promise.all([user.delete(), blog.delete(), later.delete()]); }
});
