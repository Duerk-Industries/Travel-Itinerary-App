import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import axios from 'axios';

const projectId =
  process.env.GCLOUD_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID;
const bucketName =
  process.env.LOCATION_BUCKET ||
  process.env.FIREBASE_STORAGE_BUCKET ||
  (projectId ? `${projectId}.appspot.com` : '');

if (!bucketName) {
  throw new Error('Set LOCATION_BUCKET/FIREBASE_STORAGE_BUCKET (or GCLOUD_PROJECT_ID) before running migration.');
}

if (!getApps().length) {
  initializeApp({ projectId, storageBucket: bucketName });
}

const db = getFirestore();
const bucket = getStorage().bucket(bucketName);

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'image';

const migrate = async () => {
  const snapshot = await db.collection('imageCache').get();
  let migrated = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data() as any;
    const sourceUrl = String(data?.sourceUrl || data?.url || '').trim();
    if (!sourceUrl) continue;
    if (data?.storagePath) continue;
    try {
      const response = await axios.get(sourceUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
      });
      const contentType = String(response.headers['content-type'] || 'image/jpeg');
      const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
      const provider = sourceUrl.includes('places.googleapis.com') ? 'google-places' : 'unsplash';
      const fileName = `images/${provider}/${slug(doc.id)}-${Date.now()}.${ext}`;
      await bucket.file(fileName).save(Buffer.from(response.data), {
        contentType,
        resumable: false,
      });
      await doc.ref.set(
        {
          sourceUrl,
          storagePath: fileName,
          fetchedAt: Number(data?.fetchedAt || Date.now()),
          expiresAt: Number(data?.expiresAt || Date.now() + 365 * 24 * 60 * 60 * 1000),
          provider: provider === 'google-places' ? 'google_places' : 'unsplash',
        },
        { merge: true }
      );
      migrated += 1;
      // eslint-disable-next-line no-console
      console.log(`migrated ${doc.id}`);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn(`failed ${doc.id}: ${err?.message || err}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`done: migrated ${migrated} image cache docs`);
};

migrate().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
