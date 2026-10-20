import { getCurrentDbProvider } from '../src/db';

// Fixtures and assertions that need to look at stored rows, on whichever adapter is active.
// pg-mem is the default; the Firestore emulator is used with JEST_DB_PROVIDER=firebase. Tests
// should prefer the public API and db facade, and use these only where a stored shape (for
// example, that a secret is encrypted) is the thing being checked.

export const isFirebase = (): boolean => getCurrentDbProvider() === 'firebase';

export const firestore = () => (require('../src/db.firebase') as typeof import('../src/db.firebase')).getDb();

export const sql = <T = any>(text: string, params: unknown[] = []) =>
  (require('../src/db.postgres') as typeof import('../src/db.postgres')).queryBlog<T>(text, params);

export const docs = async (collection: string, filters: Array<[string, unknown]> = []): Promise<Array<Record<string, any> & { _id: string }>> => {
  let query: FirebaseFirestore.Query = firestore().collection(collection);
  for (const [field, value] of filters) query = query.where(field, '==', value);
  return (await query.get()).docs.map(doc => ({ ...(doc.data() as Record<string, any>), _id: doc.id }));
};
