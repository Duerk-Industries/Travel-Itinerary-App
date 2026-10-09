import type { PoolClient } from 'pg';
import type { Firestore } from 'firebase-admin/firestore';

type DeletedTargetKind = 'item' | 'asset';

// Soft-deleting an item does not trigger the SQL foreign-key cascades. Remove
// engagement attached to that target, while leaving day reactions untouched.
export const clearPostgresDeletedTarget = async (client: PoolClient, kind: DeletedTargetKind, id: string): Promise<void> => {
  const column = kind === 'item' ? 'blog_item_id' : 'asset_id';
  await client.query(`DELETE FROM blog_reactions WHERE ${column} = $1`, [id]);
  await client.query(`DELETE FROM blog_curation_stars WHERE ${column} = $1`, [id]);
  await client.query('DELETE FROM blog_engagement_counters WHERE target_kind = $1 AND target_id = $2', [kind, id]);
};

export const clearFirebaseDeletedTarget = async (db: Firestore, kind: DeletedTargetKind, id: string): Promise<void> => {
  const starField = kind === 'item' ? 'blogItemId' : 'assetId';
  const [reactions, stars] = await Promise.all([
    db.collection('blog_reactions').where('targetId', '==', id).get(),
    db.collection('blog_curation_stars').where(starField, '==', id).get(),
  ]);
  const refs = [
    ...reactions.docs.filter((doc) => doc.data().targetKind === kind).map((doc) => doc.ref),
    ...stars.docs.filter((doc) => doc.data().targetKind === kind).map((doc) => doc.ref),
    ...(['travelers', 'followers', 'public'] as const).map((audience) => db.collection('blog_engagement_counters').doc(`${kind}:${id}:${audience}`)),
  ];
  for (let offset = 0; offset < refs.length; offset += 400) {
    const batch = db.batch();
    for (const ref of refs.slice(offset, offset + 400)) batch.delete(ref);
    await batch.commit();
  }
};
