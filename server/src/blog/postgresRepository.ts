import { randomUUID } from 'crypto';
import { ensureUserCanReadTrip, ensureUserInTrip } from '../db';
import { queryBlog } from '../db.postgres';
import { fetchOverviewWeather } from '../apis/openMeteoWeatherApi';
import { BlogAudience, BlogCapabilities, BlogDocument, BlogDay, BlogTextInput, BlogTextItem, BlogTextPatch, BlogActivity } from './types';

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
  // Deliberately not `INSERT ... SELECT ... FROM trips`, and an explicit client-generated id
  // rather than the trip_blogs.id DEFAULT uuid_generate_v4(): the pg-mem test adapter's DEFAULT
  // UUID generator can repeat a value already used by an earlier row in this table within one
  // test run, producing a spurious primary-key collision a real Postgres server would not hit.
  const trip = await queryBlog<{ name: string | null }>('SELECT name FROM trips WHERE id = $1', [tripId]);
  if (!trip.rows[0]) throw new Error('Trip not found');
  const title = trip.rows[0].name?.trim() || 'Trip Blog';
  try {
    const created = await queryBlog<BlogRow>(
      `INSERT INTO trip_blogs (id, trip_id, title) VALUES ($1, $2, $3) RETURNING *`,
      [randomUUID(), tripId, title]
    );
    if (created.rows[0]) return created.rows[0];
  } catch {
    // Lost the race to a concurrent creator.
  }
  const retry = await queryBlog<BlogRow>('SELECT * FROM trip_blogs WHERE trip_id = $1 LIMIT 1', [tripId]);
  if (retry.rows[0]) return retry.rows[0];
  throw new Error('Trip not found');
};

const ensureDays = async (tripId: string): Promise<void> => {
  const trip = await queryBlog<{ start_date: string | null; end_date: string | null }>(
    'SELECT start_date, end_date FROM trips WHERE id = $1 LIMIT 1',
    [tripId]
  );
  if (!trip.rows[0]) throw new Error('Trip not found');
  let start = trip.rows[0].start_date ? formatDate(trip.rows[0].start_date) : '';
  let end = trip.rows[0].end_date ? formatDate(trip.rows[0].end_date) : '';
  if (!start || !end) {
    const activityDates = await queryBlog<{ date: string }>('SELECT date FROM tours WHERE trip_id = $1 AND date IS NOT NULL ORDER BY date ASC', [tripId]);
    const dates = activityDates.rows.map((row) => formatDate(row.date));
    if (!start && dates.length) start = dates[0];
    if (!end && dates.length) end = dates[dates.length - 1];
  }
  start = start || formatDate(new Date());
  end = end || start;
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
  sourceType: row.source_type == null ? null : String(row.source_type) as 'itinerary_detail',
  sourceId: row.source_id == null ? null : String(row.source_id),
  sourceDetached: Boolean(row.source_detached),
});

const sourceBody = (row: any): string => row.kind === 'note'
  ? String(row.note_body ?? row.activity ?? '')
  : `Location: ${String(row.activity ?? 'Location')}${row.note_body ? `\n${String(row.note_body)}` : ''}`;

const sourceSnapshot = (row: any, body: string): string => JSON.stringify({ body, day: Number(row.day), activity: String(row.activity ?? ''), kind: String(row.kind ?? 'activity'), placeId: row.place_id == null ? null : String(row.place_id), noteBody: row.note_body == null ? null : String(row.note_body) });

const syncLinkedItineraryItems = async (tripId: string, userId: string): Promise<void> => {
  const sources = await queryBlog<any>(
    `SELECT d.id, d.day, d.activity, d.kind, d.place_id, d.note_body, t.start_date
     FROM itinerary_details d JOIN itineraries i ON i.id = d.itinerary_id JOIN trips t ON t.id = i.trip_id
     WHERE i.trip_id = $1 AND d.kind IN ('note', 'place') ORDER BY d.day ASC, d.position ASC, d.created_at ASC`,
    [tripId]
  );
  const days = await queryBlog<{ id: string; local_date: string }>('SELECT id, local_date FROM blog_days WHERE trip_id = $1 ORDER BY local_date ASC', [tripId]);
  const sourceIds = new Set<string>();
  for (const row of sources.rows) {
    sourceIds.add(String(row.id));
    const body = sourceBody(row);
    if (!body.trim()) continue;
    const snapshot = sourceSnapshot(row, body);
    const day = days.rows[Math.max(0, Number(row.day) - 1)] ?? days.rows[0];
    if (!day) continue;
    const linked = await queryBlog<any>(`SELECT l.item_id, l.source_snapshot, l.detached, i.version FROM blog_item_source_links l JOIN blog_items i ON i.id = l.item_id WHERE l.source_type = 'itinerary_detail' AND l.source_id = $1 LIMIT 1`, [row.id]);
    if (!linked.rows[0]) {
      const itemId = randomUUID();
      await queryBlog(`INSERT INTO blog_items (id, trip_id, blog_day_id, kind_key, schema_version, audience, sort_key, author_user_id, last_editor_user_id, planned_activity_ref) VALUES ($1, $2, $3, 'core.text', 1, 'public', $4, $5, $5, $6)`, [itemId, tripId, day.id, `${String(Date.now()).padStart(16, '0')}-${itemId}`, userId, row.id]);
      await queryBlog('INSERT INTO blog_text_contents (item_id, body, language_tag) VALUES ($1, $2, NULL)', [itemId, body]);
      await queryBlog(`INSERT INTO blog_item_versions (id, item_id, version, editor_user_id, change_kind, content_snapshot) VALUES ($1, $2, 1, $3, 'source_sync', $4::jsonb)`, [randomUUID(), itemId, userId, JSON.stringify({ body, sourceId: row.id })]);
      await queryBlog(`INSERT INTO blog_item_source_links (item_id, source_type, source_id, source_snapshot) VALUES ($1, 'itinerary_detail', $2, $3::jsonb)`, [itemId, row.id, snapshot]);
      await queryBlog('UPDATE trip_blogs SET content_revision = content_revision + 1, updated_at = NOW() WHERE trip_id = $1', [tripId]);
      continue;
    }
    if (linked.rows[0].detached) continue;
    const previous = typeof linked.rows[0].source_snapshot === 'string' ? linked.rows[0].source_snapshot : JSON.stringify(linked.rows[0].source_snapshot ?? {});
    if (previous === snapshot) continue;
    const nextVersion = Number(linked.rows[0].version ?? 1) + 1;
    await queryBlog('UPDATE blog_items SET blog_day_id = $2, version = $3, last_editor_user_id = $4, updated_at = NOW() WHERE id = $1', [linked.rows[0].item_id, day.id, nextVersion, userId]);
    await queryBlog('UPDATE blog_text_contents SET body = $2 WHERE item_id = $1', [linked.rows[0].item_id, body]);
    await queryBlog(`INSERT INTO blog_item_versions (id, item_id, version, editor_user_id, change_kind, content_snapshot) VALUES ($1, $2, $3, $4, 'source_sync', $5::jsonb)`, [randomUUID(), linked.rows[0].item_id, nextVersion, userId, JSON.stringify({ body, sourceId: row.id })]);
    await queryBlog('UPDATE blog_item_source_links SET source_snapshot = $2::jsonb, updated_at = NOW() WHERE item_id = $1', [linked.rows[0].item_id, snapshot]);
    await queryBlog('UPDATE trip_blogs SET content_revision = content_revision + 1, updated_at = NOW() WHERE trip_id = $1', [tripId]);
  }
  const staleLinks = await queryBlog<{ item_id: string; source_id: string }>(`SELECT l.item_id, l.source_id FROM blog_item_source_links l JOIN blog_items i ON i.id = l.item_id WHERE i.trip_id = $1 AND l.source_type = 'itinerary_detail' AND l.detached = FALSE`, [tripId]);
  for (const link of staleLinks.rows) if (!sourceIds.has(String(link.source_id))) await queryBlog('UPDATE blog_item_source_links SET detached = TRUE, updated_at = NOW() WHERE item_id = $1', [link.item_id]);
};

export const getBlog = async (userId: string, tripId: string, options: { date?: string; cursor?: string; limit?: number } = {}): Promise<BlogDocument> => {
  const access = await ensureUserCanReadTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to view this trip');
  const blogResult = await queryBlog<BlogRow>('SELECT * FROM trip_blogs WHERE trip_id = $1 LIMIT 1', [tripId]);
  const blog = blogResult.rows[0];
  await ensureDays(tripId);
  if (await ensureUserInTrip(tripId, userId)) await syncLinkedItineraryItems(tripId, userId);

  const limit = Math.min(100, Math.max(1, options.limit ?? 7));
  const dateFilter = options.date ? 'AND local_date = $2::date' : '';
  const cursorFilter = options.cursor ? 'AND local_date > $2::date' : '';
  const filterParams = [tripId];
  if (options.date) filterParams.push(options.date);
  else if (options.cursor) filterParams.push(options.cursor);

  const daysResult = await queryBlog<any>(
    `SELECT id, trip_id, local_date, headline, summary
     FROM blog_days WHERE trip_id = $1 ${dateFilter} ${cursorFilter}
     ORDER BY local_date ASC LIMIT $${filterParams.length + 1}`,
    [...filterParams, limit]
  );

  const dayIds = daysResult.rows.map(r => String(r.id));
  const placeholders = dayIds.map((_, i) => `$${i + 2}`).join(',');
  const itemsResult = dayIds.length ? await queryBlog<any>(
    `SELECT i.*, t.body, t.language_tag, d.local_date, sl.source_type, sl.source_id, sl.detached AS source_detached
     FROM blog_items i
     JOIN blog_days d ON d.id = i.blog_day_id
     LEFT JOIN blog_text_contents t ON t.item_id = i.id
     LEFT JOIN blog_item_source_links sl ON sl.item_id = i.id
     WHERE i.trip_id = $1 AND i.blog_day_id IN (${placeholders}) AND i.deleted_at IS NULL
    ORDER BY d.local_date ASC, i.sort_key ASC, i.created_at ASC`,
    [tripId, ...dayIds]
  ) : { rows: [] };
  const activitiesResult = dayIds.length ? await queryBlog<any>(
    `SELECT id, to_char(date, 'YYYY-MM-DD') AS local_date, name, activity_type, start_time, duration, status, start_location, notes
     FROM tours WHERE trip_id = $1 AND date IS NOT NULL AND date >= $2::date AND date <= $3::date
     ORDER BY date ASC, start_time ASC NULLS LAST, created_at ASC`,
    [tripId, formatDate(daysResult.rows[0].local_date), formatDate(daysResult.rows[daysResult.rows.length - 1].local_date)]
  ) : { rows: [] };
  const activitiesByDate = new Map<string, BlogActivity[]>();
  for (const row of activitiesResult.rows) {
    const date = String(row.local_date);
    const activity: BlogActivity = { id: String(row.id), name: String(row.name ?? 'Activity'), activityType: String(row.activity_type ?? 'Tour'), date, startTime: row.start_time == null ? null : String(row.start_time), duration: row.duration == null ? null : String(row.duration), status: row.status == null ? null : String(row.status), startLocation: row.start_location == null ? null : String(row.start_location), notes: row.notes == null ? null : String(row.notes) };
    activitiesByDate.set(date, [...(activitiesByDate.get(date) ?? []), activity]);
  }

  const byDay = new Map<string, BlogTextItem[]>();
  for (const row of itemsResult.rows) {
    if (row.kind_key !== 'core.text') continue;
    const key = String(row.blog_day_id);
    const list = byDay.get(key) ?? [];
    list.push(mapItem(row));
    byDay.set(key, list);
  }

  // Weather Badge Integration
  const weatherRequests = daysResult.rows.map(r => ({
    date: formatDate(r.local_date),
    location: r.headline || r.summary || 'Destination' // Fallback to a generic location
  })).filter(r => r.location !== 'Destination');

  // Attempt to get a real location from the trip if headlines are missing
  if (weatherRequests.length < daysResult.rows.length) {
    const tripLocation = await queryBlog<{ name: string }>('SELECT name FROM trips WHERE id = $1', [tripId]);
    const fallbackLocation = tripLocation.rows[0]?.name || 'Destination';
    daysResult.rows.forEach(r => {
      const date = formatDate(r.local_date);
      if (!weatherRequests.find(w => w.date === date)) {
        weatherRequests.push({ date, location: fallbackLocation });
      }
    });
  }

  const { weather } = await fetchOverviewWeather(weatherRequests).catch(() => ({ weather: [] }));
  const weatherByDate = new Map(weather.map(w => [w.date, w]));

  const days: BlogDay[] = daysResult.rows.map((row) => {
    const date = formatDate(row.local_date);
    const dayWeather = weatherByDate.get(date);
    return {
      id: String(row.id),
      tripId: String(row.trip_id),
      localDate: date,
      headline: row.headline == null ? null : String(row.headline),
      summary: row.summary == null ? null : String(row.summary),
      items: byDay.get(String(row.id)) ?? [],
      activities: activitiesByDate.get(date) ?? [],
      weather: dayWeather ? {
        icon: dayWeather.icon,
        description: dayWeather.description,
        temperatureHighC: dayWeather.temperatureHighC
      } : undefined
    };
  });

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
  await queryBlog('UPDATE blog_item_source_links SET detached = TRUE, updated_at = NOW() WHERE item_id = $1', [itemId]);
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
  await queryBlog('UPDATE blog_item_source_links SET detached = TRUE, updated_at = NOW() WHERE item_id = $1', [itemId]);
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
