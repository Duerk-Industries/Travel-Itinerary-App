import { Router } from 'express';
import { queryBlog } from '../db.postgres';

const router = Router();
router.get('/:username/:tripSlug', async (req, res) => {
  const alias = await queryBlog<any>(`SELECT a.trip_id, a.username_slug, a.trip_slug, b.title, b.subtitle, b.introduction, b.content_revision, b.visibility_epoch, b.indexing_enabled FROM blog_public_aliases a JOIN trip_blogs b ON b.trip_id = a.trip_id JOIN blog_publication_epochs e ON e.trip_id = a.trip_id AND e.state = 'public' WHERE a.username_slug = $1 AND a.trip_slug = $2 AND (a.redirect_until IS NULL OR a.redirect_until > NOW()::timestamp) ORDER BY a.canonical DESC LIMIT 1`, [String(req.params.username).toLowerCase(), String(req.params.tripSlug).toLowerCase()]);
  if (!alias.rows[0]) return res.status(404).json({ error: 'Public blog not found' });
  const days = await queryBlog<any>('SELECT id, local_date, headline, summary FROM blog_days WHERE trip_id = $1 ORDER BY local_date ASC', [alias.rows[0].trip_id]);
  const items = await queryBlog<any>(
    `SELECT i.id, i.blog_day_id, i.kind_key, i.schema_version, i.audience, i.sort_key, t.body, t.language_tag,
            a.id AS asset_id, a.media_kind_key, a.caption, a.alt_text, a.object_key
     FROM blog_items i
     LEFT JOIN blog_text_contents t ON t.item_id = i.id
     LEFT JOIN blog_item_assets ia ON ia.item_id = i.id
     LEFT JOIN blog_media_assets a ON a.id = ia.asset_id AND a.state = 'ready' AND a.moderation_state <> 'blocked'
     WHERE i.trip_id = $1 AND i.deleted_at IS NULL AND i.audience = 'public'
     ORDER BY i.sort_key`,
    [alias.rows[0].trip_id]
  );
  const byDay = new Map<string, any[]>();
  for (const item of items.rows) {
    const list = byDay.get(String(item.blog_day_id)) ?? [];
    const base = { id: item.id, kindKey: item.kind_key, schemaVersion: item.schema_version, audience: item.audience, sortKey: item.sort_key };
    if (item.kind_key === 'core.text') {
      list.push({ ...base, body: item.body ?? '', languageTag: item.language_tag ?? null });
    } else if (item.kind_key.startsWith('media.')) {
      list.push({ ...base, assetId: item.asset_id, mediaKind: item.media_kind_key, caption: item.caption, altText: item.alt_text, objectKey: item.object_key });
    }
    byDay.set(String(item.blog_day_id), list);
  }
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300'); res.setHeader('X-Robots-Tag', alias.rows[0].indexing_enabled ? 'index,follow' : 'noindex');
  res.json({ title: alias.rows[0].title, subtitle: alias.rows[0].subtitle, introduction: alias.rows[0].introduction, contentRevision: Number(alias.rows[0].content_revision ?? 0), visibilityEpoch: Number(alias.rows[0].visibility_epoch ?? 0), days: days.rows.map((d) => ({ localDate: new Date(d.local_date).toISOString().slice(0, 10), headline: d.headline, summary: d.summary, items: byDay.get(String(d.id)) ?? [] })) });
});
export default router;
