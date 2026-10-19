import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { getEnvFlag } from '../env';

// Narrow Firestore write boundary for trip-bundle invalidation. Domain writes
// and revision increments commit in the SAME SDK batch/transaction. Queries,
// direct refs, snapshot refs, batches and ingestion transactions all participate.
// No asynchronous trigger, facade follow-up, or process-local version cache.
const wrapped = new WeakMap<object, Firestore>();
const originals = new WeakMap<object, any>();
const TRACKED = new Set(['trips', 'flights', 'lodgings', 'tours', 'car_rentals', 'itineraries', 'itinerary_details', 'itinerary_checklist_items', 'expenses', 'trip_payments', 'groups', 'group_members', 'group_invites', 'users', 'web_users']);
type Write = { method: 'set' | 'create' | 'update' | 'delete'; ref: any; args: any[] };
export const planningFirestore = (db: Firestore): Firestore => {
  if (!getEnvFlag('TRIP_BUNDLE_VERSIONING')) return db;
  if (wrapped.has(db)) return wrapped.get(db)!;
  const unwrap = (value: any): any => value && typeof value === 'object' ? originals.get(value) ?? value : value;
  const tracked = (ref: any): boolean => ref.path?.split('/').length === 2 && TRACKED.has(ref.parent.id);
  const flush = async (tx: any, writes: Write[], snapshots: Map<string, any>) => {
    const scopes = new Set<string>();
    const read = async (ref: any): Promise<any> => {
      const pending = writes.slice().reverse().find(write => write.ref.path === ref.path && write.method !== 'delete');
      if (pending?.method === 'create' || pending?.method === 'set') return pending.args[0];
      if (!snapshots.has(ref.path)) snapshots.set(ref.path, (await tx.get(ref)).data() || {});
      return snapshots.get(ref.path);
    };
    for (const write of writes.filter(write => tracked(write.ref))) {
      const ref = write.ref; const kind = ref.parent.id;
      if (!snapshots.has(ref.path)) snapshots.set(ref.path, (await tx.get(ref)).data() || {});
      const before = snapshots.get(ref.path);
      const after = write.method === 'delete' ? {} : { ...before, ...write.args[0] };
      for (const row of [before, after]) {
        if (kind === 'trips') scopes.add(`trip:${ref.id}`);
        else if (kind === 'groups') scopes.add(`group:${ref.id}`);
        else if ((kind === 'group_members' || kind === 'group_invites')) { if (row.groupId) scopes.add(`group:${row.groupId}`); }
        else if (kind === 'users' || kind === 'web_users') {
          if (!['email', 'firstName', 'lastName', 'preferredAirport'].some(key => before[key] !== after[key])) continue;
          scopes.add('global:profiles');
          const members = await tx.get(db.collection('group_members').where('userId', '==', ref.id).limit(101));
          if (members.size > 100) scopes.add('global:profiles');
          else members.docs.forEach((member: any) => { if (member.data().groupId) scopes.add(`group:${member.data().groupId}`); });
        } else if (kind === 'itinerary_details' || kind === 'itinerary_checklist_items') {
          const detail = kind === 'itinerary_details' ? row : row.detailId ? await read(db.collection('itinerary_details').doc(String(row.detailId))) : {};
          const itinerary = detail.itineraryId ? await read(db.collection('itineraries').doc(String(detail.itineraryId))) : {};
          if (itinerary.tripId) scopes.add(`trip:${itinerary.tripId}`);
        } else if (row.tripId ?? row.trip_id) scopes.add(`trip:${row.tripId ?? row.trip_id}`);
      }
    }
    for (const write of writes) tx[write.method](write.ref, ...write.args);
    for (const scope of scopes) tx.set(db.collection('planning_revisions').doc(scope), { revision: FieldValue.increment(1) }, { merge: true });
  };
  const transaction = (work: (tx: any) => Promise<any>, options?: any) => db.runTransaction(async raw => {
    const writes: Write[] = []; const snapshots = new Map<string, any>();
    let proxy: any;
    proxy = new Proxy(raw, { get(target, property) {
      if (['set', 'update', 'create', 'delete'].includes(String(property))) return (ref: any, ...args: any[]) => { writes.push({ method: property as Write['method'], ref: unwrap(ref), args }); return proxy; };
      if (property === 'getAll') return async (...refs: any[]) => (await raw.getAll(...refs.map(unwrap))).map((doc: any) => { snapshots.set(doc.ref.path, doc.data() || {}); return wrapSnapshot(doc); });
      if (property === 'get') return async (ref: any, ...args: any[]) => {
        const result = await (raw.get as any)(unwrap(ref), ...args);
        if (result.ref?.path) snapshots.set(result.ref.path, result.data() || {});
        else result.docs?.forEach((doc: any) => snapshots.set(doc.ref.path, doc.data()));
        return wrapSnapshot(result);
      };
      const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const result = await work(proxy); await flush(raw, writes, snapshots); return result;
  }, options);
  const wrapSnapshot = (snapshot: any): any => new Proxy(snapshot, { get(target, property) {
    if (property === 'ref') return wrapRef(target.ref);
    if (property === 'docs') return target.docs.map(wrapSnapshot);
    if (property === 'forEach') return (callback: (doc: any) => void) => target.docs.map(wrapSnapshot).forEach(callback);
    const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const wrapRef = (ref: any): any => {
    const proxy = new Proxy(ref, { get(target, property) {
      if (property === 'doc' || property === 'collection') return (...args: any[]) => wrapRef(target[property](...args));
      if (['where', 'orderBy', 'limit', 'offset', 'startAfter', 'startAt', 'endBefore', 'endAt', 'select'].includes(String(property))) return (...args: any[]) => wrapRef(target[property](...args.map(unwrap)));
      if (property === 'get') return async (...args: any[]) => wrapSnapshot(await target.get(...args));
      if (['set', 'update', 'create', 'delete'].includes(String(property)) && tracked(target)) return (...args: any[]) => transaction(async tx => { tx[property](target, ...args); });
      const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
    } }); originals.set(proxy, ref); return proxy;
  };
  const proxy = new Proxy(db, { get(target, property) {
    if (property === 'collection' || property === 'doc' || property === 'collectionGroup') return (...args: any[]) => wrapRef((target as any)[property](...args));
    if (property === 'getAll') return async (...refs: any[]) => (await db.getAll(...refs.map(unwrap))).map(wrapSnapshot);
    if (property === 'runTransaction') return transaction;
    if (property === 'batch') return () => {
      const writes: Write[] = []; const batch: any = {};
      for (const method of ['set', 'create', 'update', 'delete'] as const) batch[method] = (ref: any, ...args: any[]) => { writes.push({ method, ref: unwrap(ref), args }); return batch; };
      batch.commit = () => db.runTransaction(async tx => { await flush(tx, writes, new Map()); });
      return batch;
    };
    const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  wrapped.set(db, proxy); return proxy;
};
