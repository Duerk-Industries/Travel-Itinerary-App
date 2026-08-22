import { Router } from 'express';
import { queryBlog } from '../db.postgres';
import { getCurrentDbProvider } from '../db';
import { getPublicBlogFirebase, resolvePublicTripIdFirebase } from '../blog/firebasePublicationRepository';
import { isFeatureEnabled } from '../services/entitlementService';
import { HttpRateLimitExceededError, reserveHttpRateLimitOrThrow } from '../services/httpRateLimitService';
import { getApiCacheSetting } from '../config/apiLimits';
import { blogEngagementRepository } from '../blog/engagementRepository';
import { BlogComment } from '../blog/engagementTypes';

const router = Router();

// Phase 4 of docs/trip-blog-social-implementation-plan.md, architecture §5.1/§14.7 — a route
// entirely separate from GET /:username/:tripSlug above, on its own cache key, flag and rate
// limit (NFR-6, threat S9). Never appended to the public blog document: engagement changes
// (a new reaction, a new comment) must not bust the CDN cache holding the day's prose and media.
//
// Public-only projection: counters are summed for audience='public' rows alone (never
// travelers/followers), and comments are stripped down to id/body/timestamps/replyCount/authorRole
// — no author id, name, email or any other identity, per architecture §5.1's explicit list.
const sanitizePublicComment = (comment: BlogComment) => ({
  id: comment.id,
  body: comment.deletedAt ? null : comment.body,
  authorRole: comment.authorRole,
  parentCommentId: comment.parentCommentId,
  replyCount: comment.replyCount,
  createdAt: comment.createdAt,
  editedAt: comment.editedAt,
  deletedAt: comment.deletedAt,
});

const clientIp = (req: any): string => String(req.ip || req.socket?.remoteAddress || 'unknown');

router.get('/:username/:tripSlug/engagement', async (req, res) => {
  if (!(await isFeatureEnabled('trip_blog_social_layer')) || !(await isFeatureEnabled('trip_blog_public_engagement'))) {
    return res.status(404).json({ error: 'Public blog not found' });
  }
  try {
    await reserveHttpRateLimitOrThrow({
      name: 'blog_public_engagement',
      identity: `ip:${clientIp(req)}`,
      limit: Number(getApiCacheSetting('tripBlog', 'publicEngagementReadsPerMinutePerIp') ?? 60),
      windowMs: 60_000,
    });
  } catch (err) {
    if (err instanceof HttpRateLimitExceededError) {
      res.setHeader('Retry-After', String(err.retryAfterSeconds));
      return res.status(429).json({ error: err.message });
    }
    throw err;
  }

  const username = String(req.params.username);
  const tripSlug = String(req.params.tripSlug);
  const dayDate = req.query.dayDate != null ? String(req.query.dayDate) : null;
  const cursor = req.query.cursor != null ? String(req.query.cursor) : undefined;
  const limit = req.query.limit != null ? Number(req.query.limit) : undefined;

  const resolved = getCurrentDbProvider() === 'firebase'
    ? await resolvePublicTripIdFirebase(username, tripSlug)
    : await resolvePublicTripIdPostgres(username, tripSlug);
  if (!resolved) return res.status(404).json({ error: 'Public blog not found' });

  res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');

  if (!dayDate) {
    const targets = resolved.days.map((day) => ({ targetKind: 'day' as const, targetId: day.id }));
    const summaries = await blogEngagementRepository().getEngagementSummaries(null, targets, ['public']);
    const zero = { reactionCounts: {}, reactionTotal: 0, commentCount: 0 };
    return res.json({
      days: resolved.days.map((day) => {
        const s = summaries[`day:${day.id}`] ?? zero;
        return { localDate: day.localDate, reactionCounts: s.reactionCounts, reactionTotal: s.reactionTotal, commentCount: s.commentCount };
      }),
    });
  }

  const day = resolved.days.find((d) => d.localDate === dayDate);
  if (!day) return res.status(404).json({ error: 'Day not found' });
  const summaries = await blogEngagementRepository().getEngagementSummaries(null, [{ targetKind: 'day', targetId: day.id }], ['public']);
  const zero = { reactionCounts: {}, reactionTotal: 0, commentCount: 0 };
  const summary = summaries[`day:${day.id}`] ?? zero;
  const comments = await blogEngagementRepository().listTopLevelCommentsForDay(resolved.tripId, day.id, ['public'], { cursor, limit });
  res.json({
    localDate: day.localDate,
    reactionCounts: summary.reactionCounts,
    reactionTotal: summary.reactionTotal,
    commentCount: summary.commentCount,
    comments: comments.map(sanitizePublicComment),
  });
});

const resolvePublicTripIdPostgres = async (
  username: string,
  tripSlug: string
): Promise<{ tripId: string; days: Array<{ id: string; localDate: string }> } | null> => {
  const alias = await queryBlog<{ trip_id: string }>(
    `SELECT a.trip_id FROM blog_public_aliases a
     JOIN blog_publication_epochs e ON e.trip_id = a.trip_id AND e.state = 'public'
     WHERE a.username_slug = $1 AND a.trip_slug = $2 AND (a.redirect_until IS NULL OR a.redirect_until > NOW()::timestamp)
     ORDER BY a.canonical DESC LIMIT 1`,
    [username.toLowerCase(), tripSlug.toLowerCase()]
  );
  if (!alias.rows[0]) return null;
  const tripId = String(alias.rows[0].trip_id);
  const days = await queryBlog<{ id: string; local_date: string }>(
    'SELECT id, local_date FROM blog_days WHERE trip_id = $1 ORDER BY local_date ASC',
    [tripId]
  );
  return { tripId, days: days.rows.map((d) => ({ id: String(d.id), localDate: new Date(d.local_date).toISOString().slice(0, 10) })) };
};

router.get('/:username/:tripSlug', async (req, res) => {
  if (getCurrentDbProvider() === 'firebase') {
    const blog = await getPublicBlogFirebase(String(req.params.username), String(req.params.tripSlug));
    if (!blog) return res.status(404).json({ error: 'Public blog not found' });
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.setHeader('X-Robots-Tag', blog.indexingEnabled ? 'index,follow' : 'noindex');
    return res.json(blog);
  }
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
