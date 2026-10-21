import type { GeocodingState } from '../types';
import { getDb } from '../db.firebase';
import { withPlanningTransaction } from '../db.postgres';
const empty = (): GeocodingState => ({ jobs: [], nextAllowedAt: 0 });
export async function mutateGeocodingPostgres(change: (state: GeocodingState) => GeocodingState): Promise<GeocodingState> {
  return withPlanningTransaction(async client => {
    const rows = await client.query('SELECT payload FROM geocoding_state WHERE id=$1 FOR UPDATE', ['public-poi-v1']);
    if (!rows.rows[0]) throw new Error('Geocoding migration missing');
    const previous = JSON.stringify(rows.rows[0].payload);
    const next = change(structuredClone(rows.rows[0].payload));
    if (Buffer.byteLength(JSON.stringify(next)) > 700_000) throw new Error('Geocoding state full');
    if (JSON.stringify(next) !== previous) await client.query('UPDATE geocoding_state SET payload=$2 WHERE id=$1', ['public-poi-v1', JSON.stringify(next)]);
    return next;
  });
}
export async function mutateGeocodingFirebase(change: (state: GeocodingState) => GeocodingState): Promise<GeocodingState> {
  const db = getDb(); const ref = db.collection('geocoding_state').doc('public-poi-v1');
  return db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    const state = doc.exists ? doc.data() as GeocodingState : empty();
    const previous = JSON.stringify(state);
    const next = change(structuredClone(state));
    if (Buffer.byteLength(JSON.stringify(next)) > 700_000) throw new Error('Geocoding state full');
    if (!doc.exists || JSON.stringify(next) !== previous) tx.set(ref, next); return next;
  });
}
