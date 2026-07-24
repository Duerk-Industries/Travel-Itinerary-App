import { randomUUID } from 'crypto';
import { ensureUserCanReadTrip, ensureUserInTrip } from '../db';
import { queryBlog } from '../db.postgres';
import { BlogAudience, BlogCapabilities, BlogDocument, BlogDay, BlogTextInput, BlogTextItem, BlogTextPatch } from './types';

type BlogRow = {
  id: string;
  trip_id: string;
  title: string;
  subtitle: string | null;
  introduction: string | null;
  content_revision: string | number;
  visibility_state: BlogDocument['visibilityState'];
  visibility_epoch: string | number;
};

const formatDate = (value: unknown): string => new Date(String(value)).toISOString().slice(0, 10);

const ensureBlog = async (tripId: string): Promise<BlogRow> => {
  const existing = await queryBlog<BlogRow>('SELECT * FROM trip_blogs WHERE trip_id = $1 LIMIT 1', [tripId]);
  if (existing.rows[0]) return existing.rows[0];
  const created = await queryBlog<BlogRow>(
    `INSERT INTO trip_blogs (trip_id, title)
     SELECT $1, COALESCE(NULLIF(name, ''), 'Trip Blog') FROM trips WHERE id = $1
     RETURNING *`,
    [tripId]
  );
  if (created.rows[0]) return created.rows[0];
  throw new Error('Trip not found');
};

const ensureDays = async (tripId: string): Promise<void> => {
  const trip = await queryBlog<{ start_date: string | null; end_date: string | null }>(
    'SELECT start_date, end_date FROM trips WHERE id = $1 LIMIT 1',
    [tripId]
  );
  if (!trip.rows[0]) throw new Error('Trip not found');
  const start = trip.rows[0].start_date ? formatDate(trip.rows[0].start_date) : formatDate(new Date());
  const end = trip.rows[0].end_date ? formatDate(trip.rows[0].end_date) : start;
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  for (let cursor = startDate; cursor <= endDate; cursor = new Date(cursor.getTime() + 86_400_000)) {
    await queryBlog(
      `INSERT INTO blog_days (id, trip_id, local_date) VALUES ($1, $2, $3::date) ON CONFLICT (trip_id, local_date) DO NOTHING`,
      [randomUUID(), tripId, cursor.toISOString().slice(0, 10)]
    );
  }
};

const mapItem = (row: any): BlogTextItem => ({
  id: String(row.id),
  tripId: String(row.trip_id),
  blogDayId: String(row.blog_day_id),
  localDate: formatDate(row.local_date),
  kindKey: 'core.text',
  schemaVersion: Number(row.schema_version ?? 1),
  audience: row.audience as BlogAudience,
  sortKey: String(row.sort_key),
  authorUserId: String(row.author_user_id),
  lastEditorUserId: String(row.last_editor_user_id),
  version: Number(row.version ?? 1),
  body: String(row.body ?? ''),
  languageTag: row.language_tag == null ? null : String(row.language_tag),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export const getBlog = async (userId: string, tripId: string): Promise<BlogDocument> => {
  const access = await ensureUserCanReadTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to view this trip');
  const blogResult = await queryBlog<BlogRow>('SELECT * FROM trip_blogs WHERE trip_id = $1 LIMIT 1', [tripId]);
  const blog = blogResult.rows[0];
  await ensureDays(tripId);
  const daysResult = await queryBlog<any>(
    `SELECT id, trip_id, local_date, headline, summary
     FROM blog_days WHERE trip_id = $1 ORDER BY local_date ASC`,
    [tripId]
  );
  const itemsResult = await queryBlog<any>(
    `SELECT i.*, t.body, t.language_tag, d.local_date
     FROM blog_items i
     JOIN blog_days d ON d.id = i.blog_day_id
     LEFT JOIN blog_text_contents t ON t.item_id = i.id
     WHERE i.trip_id = $1 AND i.deleted_at IS NULL
     ORDER BY d.local_date ASC, i.sort_key ASC, i.created_at ASC`,
    [tripId]
  );
  const byDay = new Map<string, BlogTextItem[]>();
  for (const row of itemsResult.rows) {
    if (row.kind_key !== 'core.text') continue;
    const key = String(row.blog_day_id);
    const list = byDay.get(key) ?? [];
    list.push(mapItem(row));
    byDay.set(key, list);
  }
  const days: BlogDay[] = daysResult.rows.map((row) => ({
    id: String(row.id),
    tripId: String(row.trip_id),
    localDate: formatDate(row.local_date),
    headline: row.headline == null ? null : String(row.headline),
    summary: row.summary == null ? null : String(row.summary),
    items: byDay.get(String(row.id)) ?? [],
  }));
  return {
    id: blog ? String(blog.id) : '',
    tripId,
    title: blog?.title ?? '',
    subtitle: blog?.subtitle ?? null,
    introduction: blog?.introduction ?? null,
    contentRevision: Number(blog?.content_revision ?? 0),
    visibilityState: blog?.visibility_state ?? 'private',
    visibilityEpoch: Number(blog?.visibility_epoch ?? 0),
    days,
  };
};

export const getBlogCapabilities = async (userId: string, tripId: string, capabilities: BlogCapabilities): Promise<BlogCapabilities> => {
  const access = await ensureUserCanReadTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to view this trip');
  return capabilities;
};

const getDayId = async (tripId: string, dayDate: string): Promise<string> => {
  await ensureDays(tripId);
  const day = await queryBlog<{ id: string }>('SELECT id FROM blog_days WHERE trip_id = $1 AND local_date = $2::date LIMIT 1', [tripId, dayDate]);
  if (!day.rows[0]) throw new Error('The selected day is outside the trip range');
  return day.rows[0].id;
};

export const createBlogTextItem = async (userId: string, tripId: string, input: BlogTextInput): Promise<BlogTextItem> => {
  const access = await ensureUserInTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  const body = String(input.body ?? '');
  if (body.length > 100_000) throw new Error('Text block is too large');
  const dayId = await getDayId(tripId, input.dayDate);
  const id = randomUUID();
  const sortKey = `${Date.now().toString().padStart(16, '0')}-${id}`;
  await queryBlog(
    `INSERT INTO blog_items (id, trip_id, blog_day_id, kind_key, schema_version, audience, sort_key, author_user_id, last_editor_user_id)
     VALUES ($1, $2, $3, 'core.text', 1, $4, $5, $6, $6)`,
    [id, tripId, dayId, input.audience ?? 'public', sortKey, userId]
  );
  await queryBlog(
    `INSERT INTO blog_text_contents (item_id, body, language_tag) VALUES ($1, $2, $3)`,
    [id, body, input.languageTag ?? null]
  );
  await queryBlog(
    `INSERT INTO blog_item_versions (id, item_id, version, editor_user_id, change_kind, content_snapshot)
     VALUES ($1, $2, 1, $3, 'create', $4::jsonb)`,
    [randomUUID(), id, userId, JSON.stringify({ body, languageTag: input.languageTag ?? null })]
  );
  await queryBlog('UPDATE trip_blogs SET content_revision = content_revision + 1, updated_at = NOW() WHERE trip_id = $1', [tripId]);
  const item = await queryBlog<any>(
    `SELECT i.*, t.body, t.language_tag, d.local_date FROM blog_items i
     JOIN blog_days d ON d.id = i.blog_day_id JOIN blog_text_contents t ON t.item_id = i.id WHERE i.id = $1`,
    [id]
  );
  return mapItem(item.rows[0]);
};

export const updateBlogTextItem = async (userId: string, itemId: string, patch: BlogTextPatch): Promise<BlogTextItem | null> => {
  const current = await queryBlog<any>(
    `SELECT i.*, t.body, t.language_tag, d.local_date FROM blog_items i
     JOIN blog_days d ON d.id = i.blog_day_id JOIN blog_text_contents t ON t.item_id = i.id
     WHERE i.id = $1 AND i.deleted_at IS NULL`,
    [itemId]
  );
  if (!current.rows[0]) return null;
  const access = await ensureUserInTrip(String(current.rows[0].trip_id), userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  const row = current.rows[0];
  const body = patch.body === undefined ? String(row.body ?? '') : String(patch.body);
  if (body.length > 100_000) throw new Error('Text block is too large');
  const nextVersion = Number(row.version) + 1;
  const updated = await queryBlog<any>(
    `UPDATE blog_items SET audience = COALESCE($3, audience), last_editor_user_id = $4, version = $2, updated_at = NOW()
     WHERE id = $1 AND version = $5 AND deleted_at IS NULL RETURNING *`,
    [itemId, nextVersion, patch.audience ?? null, userId, patch.version]
  );
  if (!updated.rows[0]) return null;
  await queryBlog('UPDATE blog_text_contents SET body = $2, language_tag = $3 WHERE item_id = $1', [itemId, body, patch.languageTag ?? row.language_tag ?? null]);
  await queryBlog(
    `INSERT INTO blog_item_versions (id, item_id, version, editor_user_id, change_kind, content_snapshot)
     VALUES ($1, $2, $3, $4, 'update', $5::jsonb)`,
    [randomUUID(), itemId, nextVersion, userId, JSON.stringify({ body, languageTag: patch.languageTag ?? row.language_tag ?? null })]
  );
  await queryBlog('UPDATE trip_blogs SET content_revision = content_revision + 1, updated_at = NOW() WHERE trip_id = $1', [row.trip_id]);
  const result = await queryBlog<any>(
    `SELECT i.*, t.body, t.language_tag, d.local_date FROM blog_items i JOIN blog_days d ON d.id = i.blog_day_id JOIN blog_text_contents t ON t.item_id = i.id WHERE i.id = $1`,
    [itemId]
  );
  return mapItem(result.rows[0]);
};

export const deleteBlogItem = async (userId: string, itemId: string, version?: number): Promise<boolean> => {
  const current = await queryBlog<any>('SELECT id, trip_id, version FROM blog_items WHERE id = $1 AND deleted_at IS NULL', [itemId]);
  if (!current.rows[0]) return false;
  const access = await ensureUserInTrip(String(current.rows[0].trip_id), userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  const updated = await queryBlog('UPDATE blog_items SET deleted_at = NOW(), version = version + 1, last_editor_user_id = $2, updated_at = NOW() WHERE id = $1 AND ($3::int IS NULL OR version = $3) AND deleted_at IS NULL', [itemId, userId, version ?? null]);
  if (!updated.rowCount) return false;
  await queryBlog('UPDATE trip_blogs SET content_revision = content_revision + 1, updated_at = NOW() WHERE trip_id = $1', [current.rows[0].trip_id]);
  return true;
};

export const reorderBlogItems = async (userId: string, tripId: string, itemIds: string[]): Promise<void> => {
  const access = await ensureUserInTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  for (let index = 0; index < itemIds.length; index += 1) {
    await queryBlog('UPDATE blog_items SET sort_key = $3, updated_at = NOW(), last_editor_user_id = $4 WHERE id = $1 AND trip_id = $2 AND deleted_at IS NULL', [itemIds[index], tripId, String(index).padStart(12, '0'), userId]);
  }
  await queryBlog('UPDATE trip_blogs SET content_revision = content_revision + 1, updated_at = NOW() WHERE trip_id = $1', [tripId]);
};
