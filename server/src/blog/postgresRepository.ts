import { randomUUID } from 'crypto';
import { ensureUserCanReadTrip, ensureUserInTrip } from '../db';
import { queryBlog, withBlogTransaction } from '../db.postgres';
import { fetchOverviewWeather } from '../apis/openMeteoWeatherApi';
import { BlogAudience, BlogCapabilities, BlogDocument, BlogDay, BlogTextInput, BlogTextItem, BlogTextPatch, BlogTextUpdateResult, BlogActivity, BlogGalleryItem, BlogDayMetaPatch, BlogDayMetaUpdateResult, BlogMastheadPatch } from './types';
import { buildNarrativeBlogBody } from './narrative';
import { logError } from '../logger';
import { markSynced, shouldSkipSync } from './syncCoordination';

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

const sourceBody = (row: any): string => buildNarrativeBlogBody({
  activity: row.activity,
  kind: row.kind,
  noteBody: row.note_body,
});

const sourceSnapshot = (row: any, body: string): string => JSON.stringify({ body, day: Number(row.day), activity: String(row.activity ?? ''), kind: String(row.kind ?? 'activity'), placeId: row.place_id == null ? null : String(row.place_id), noteBody: row.note_body == null ? null : String(row.note_body) });

// Processes one itinerary_details row's blog link independently of every other row —
// nothing here reads another row's outcome — so the caller runs these concurrently via
// Promise.all rather than one row at a time. The `content_revision = content_revision + 1`
// increments stay correct under that concurrency because each is a single atomic SQL
// UPDATE; Postgres row-locks the trip_blogs row for the instant of each statement, so
// concurrent increments from parallel connections still all land (no lost updates) —
// this is not the read-then-write race the Firestore adapter has to guard against with
// FieldValue.increment.
const syncOneItineraryDetail = async (
  row: any,
  tripId: string,
  userId: string,
  daysByIndex: Array<{ id: string; local_date: string }>
): Promise<void> => {
  const body = sourceBody(row);
  if (!body.trim()) return;
  const snapshot = sourceSnapshot(row, body);
  const day = daysByIndex[Math.max(0, Number(row.day) - 1)] ?? daysByIndex[0];
  if (!day) return;
  const linked = await queryBlog<any>(`SELECT l.item_id, l.source_snapshot, l.detached, i.version FROM blog_item_source_links l JOIN blog_items i ON i.id = l.item_id WHERE l.source_type = 'itinerary_detail' AND l.source_id = $1 LIMIT 1`, [row.id]);
  if (!linked.rows[0]) {
    const itemId = randomUUID();
    await queryBlog(`INSERT INTO blog_items (id, trip_id, blog_day_id, kind_key, schema_version, audience, sort_key, author_user_id, last_editor_user_id, planned_activity_ref) VALUES ($1, $2, $3, 'core.text', 1, 'public', $4, $5, $5, $6)`, [itemId, tripId, day.id, `${String(Date.now()).padStart(16, '0')}-${itemId}`, userId, row.id]);
    await queryBlog('INSERT INTO blog_text_contents (item_id, body, language_tag) VALUES ($1, $2, NULL)', [itemId, body]);
    await queryBlog(`INSERT INTO blog_item_versions (id, item_id, version, editor_user_id, change_kind, content_snapshot) VALUES ($1, $2, 1, $3, 'source_sync', $4::jsonb)`, [randomUUID(), itemId, userId, JSON.stringify({ body, sourceId: row.id })]);
    await queryBlog(`INSERT INTO blog_item_source_links (item_id, source_type, source_id, source_snapshot) VALUES ($1, 'itinerary_detail', $2, $3::jsonb)`, [itemId, row.id, snapshot]);
    await queryBlog('UPDATE trip_blogs SET content_revision = content_revision + 1, updated_at = NOW() WHERE trip_id = $1', [tripId]);
    return;
  }
  if (linked.rows[0].detached) return;
  const previous = typeof linked.rows[0].source_snapshot === 'string' ? linked.rows[0].source_snapshot : JSON.stringify(linked.rows[0].source_snapshot ?? {});
  if (previous === snapshot) return;
  const nextVersion = Number(linked.rows[0].version ?? 1) + 1;
  await queryBlog('UPDATE blog_items SET blog_day_id = $2, version = $3, last_editor_user_id = $4, updated_at = NOW() WHERE id = $1', [linked.rows[0].item_id, day.id, nextVersion, userId]);
  await queryBlog('UPDATE blog_text_contents SET body = $2 WHERE item_id = $1', [linked.rows[0].item_id, body]);
  await queryBlog(`INSERT INTO blog_item_versions (id, item_id, version, editor_user_id, change_kind, content_snapshot) VALUES ($1, $2, $3, $4, 'source_sync', $5::jsonb)`, [randomUUID(), linked.rows[0].item_id, nextVersion, userId, JSON.stringify({ body, sourceId: row.id })]);
  await queryBlog('UPDATE blog_item_source_links SET source_snapshot = $2::jsonb, updated_at = NOW() WHERE item_id = $1', [linked.rows[0].item_id, snapshot]);
  await queryBlog('UPDATE trip_blogs SET content_revision = content_revision + 1, updated_at = NOW() WHERE trip_id = $1', [tripId]);
};

const syncLinkedItineraryItems = async (tripId: string, userId: string): Promise<void> => {
  const [sources, days] = await Promise.all([
    queryBlog<any>(
      `SELECT d.id, d.day, d.activity, d.kind, d.place_id, d.note_body, t.start_date
       FROM itinerary_details d JOIN itineraries i ON i.id = d.itinerary_id JOIN trips t ON t.id = i.trip_id
       WHERE i.trip_id = $1 AND d.kind IN ('note', 'place') ORDER BY d.day ASC, d.position ASC, d.created_at ASC`,
      [tripId]
    ),
    queryBlog<{ id: string; local_date: string }>('SELECT id, local_date FROM blog_days WHERE trip_id = $1 ORDER BY local_date ASC', [tripId]),
  ]);
  const sourceIds = new Set(sources.rows.map((row) => String(row.id)));
  await Promise.all(sources.rows.map((row) => syncOneItineraryDetail(row, tripId, userId, days.rows)));

  const staleLinks = await queryBlog<{ item_id: string; source_id: string }>(`SELECT l.item_id, l.source_id FROM blog_item_source_links l JOIN blog_items i ON i.id = l.item_id WHERE i.trip_id = $1 AND l.source_type = 'itinerary_detail' AND l.detached = FALSE`, [tripId]);
  await Promise.all(
    staleLinks.rows
      .filter((link) => !sourceIds.has(String(link.source_id)))
      .map((link) => queryBlog('UPDATE blog_item_source_links SET detached = TRUE, updated_at = NOW() WHERE item_id = $1', [link.item_id]))
  );
  markSynced(tripId);
};

// Public entry point for the write-path trigger (itineraryDataRoutes.ts,
// itineraryAsyncService.ts): fire this in the background right after an
// itinerary_details mutation, so the blog is already caught up before the
// next GET /blog arrives instead of that GET paying the sync cost itself.
// Errors are logged, not thrown — a failed background sync must never surface
// as a failure of the itinerary edit/generation request that triggered it;
// the read-path sync in getBlog remains as a defensive fallback either way.
export const syncItineraryToBlog = async (tripId: string, userId: string): Promise<void> => {
  try {
    // Unlike getBlog, this can be the *first* thing that ever touches this trip's blog
    // (e.g. AI itinerary generation firing this immediately after trip creation, before
    // the traveler has ever opened the Trip Blog tab) — so trip_blogs/blog_days can't be
    // assumed to exist yet the way getBlog's caller-already-visited-the-tab assumption
    // gets to. Without this, syncOneItineraryDetail's `daysByIndex[...]` lookup finds
    // nothing, every row hits its `if (!day) return`, and the sync silently links zero
    // items — not an error, just quietly does nothing.
    await ensureBlog(tripId);
    await ensureDays(tripId);
    await syncLinkedItineraryItems(tripId, userId);
  } catch (err) {
    logError(`[blog] background itinerary sync failed for trip ${tripId}`, err);
  }
};

export const getBlog = async (userId: string, tripId: string, options: { date?: string; cursor?: string; limit?: number } = {}): Promise<BlogDocument> => {
  const access = await ensureUserCanReadTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to view this trip');
  // Pre-existing gap: `ensureBlog` (below) lazily creates the trip_blogs row, but this function
  // used to read it with a plain SELECT and never called ensureBlog — so on Postgres/pg-mem (the
  // memory/test adapter runs this same module) a trip's first-ever GET /blog left no trip_blogs
  // row behind, `content_revision`/`visibilityEpoch` silently stayed pinned at the `?? 0` default
  // forever, and the ETag never changed no matter how many mutations happened. The Firebase
  // repository's getBlog already calls ensureBlog (line ~104 of firebaseRepository.ts); this
  // brings Postgres in line with it.
  const blog = await ensureBlog(tripId);
  await ensureDays(tripId);
  // The write-path trigger (see syncItineraryToBlog) is the primary sync mechanism now;
  // this stays as a defensive fallback for any mutation path that isn't hooked into it,
  // so the read path doesn't need to re-run a full sync on every single GET — skip if one
  // completed recently (see syncCoordination.ts for why this is always safe to skip, never
  // stale: mutations invalidate the debounce window synchronously before returning).
  if (!shouldSkipSync(tripId) && (await ensureUserInTrip(tripId, userId))) {
    await syncLinkedItineraryItems(tripId, userId);
  }

  const limit = Math.min(100, Math.max(1, options.limit ?? 7));
  const dateFilter = options.date ? 'AND local_date = $2::date' : '';
  const cursorFilter = options.cursor ? 'AND local_date > $2::date' : '';
  const filterParams = [tripId];
  if (options.date) filterParams.push(options.date);
  else if (options.cursor) filterParams.push(options.cursor);

  const daysResult = await queryBlog<any>(
    `SELECT id, trip_id, local_date, headline, summary, cover_asset_id, update_version
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
      coverAssetId: row.cover_asset_id == null ? null : String(row.cover_asset_id),
      updateVersion: Number(row.update_version ?? 1),
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

export const createGalleryItem = async (userId: string, tripId: string, input: { dayDate: string; caption?: string | null; audience?: BlogAudience }): Promise<BlogGalleryItem> => {
  const access = await ensureUserInTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  const dayId = await getDayId(tripId, input.dayDate);
  const id = randomUUID();
  const sortKey = `${Date.now().toString().padStart(16, '0')}-${id}`;
  await queryBlog(
    `INSERT INTO blog_items (id, trip_id, blog_day_id, kind_key, schema_version, audience, sort_key, author_user_id, last_editor_user_id)
     VALUES ($1, $2, $3, 'core.gallery', 1, $4, $5, $6, $6)`,
    [id, tripId, dayId, input.audience ?? 'public', sortKey, userId]
  );
  if (input.caption) {
    await queryBlog('INSERT INTO blog_item_payloads (item_id, payload) VALUES ($1, $2::jsonb)', [id, JSON.stringify({ caption: input.caption })]);
  }
  await queryBlog('UPDATE trip_blogs SET content_revision = content_revision + 1, updated_at = NOW() WHERE trip_id = $1', [tripId]);
  const row = await queryBlog<any>('SELECT i.*, d.local_date FROM blog_items i JOIN blog_days d ON d.id = i.blog_day_id WHERE i.id = $1', [id]);
  const item = row.rows[0];
  return {
    id, tripId, blogDayId: dayId, localDate: formatDate(item.local_date), kindKey: 'core.gallery', schemaVersion: 1,
    audience: item.audience as BlogAudience, sortKey, authorUserId: userId, lastEditorUserId: userId, version: 1,
    caption: input.caption ?? null, createdAt: new Date(item.created_at).toISOString(), updatedAt: new Date(item.updated_at).toISOString(), assets: [],
  };
};

export const getGalleryItemsMeta = async (tripId: string, itemIds: string[]): Promise<Record<string, { blogDayId: string; sortKey: string; audience: BlogAudience; authorUserId: string; lastEditorUserId: string; version: number; caption: string | null; createdAt: string; updatedAt: string }>> => {
  if (!itemIds.length) return {};
  const placeholders = itemIds.map((_, i) => `$${i + 2}`).join(',');
  const rows = await queryBlog<any>(
    `SELECT i.id, i.blog_day_id, i.sort_key, i.audience, i.author_user_id, i.last_editor_user_id, i.version, i.created_at, i.updated_at, p.payload
     FROM blog_items i LEFT JOIN blog_item_payloads p ON p.item_id = i.id
     WHERE i.trip_id = $1 AND i.id IN (${placeholders}) AND i.deleted_at IS NULL AND i.kind_key = 'core.gallery'`,
    [tripId, ...itemIds]
  );
  const out: Record<string, any> = {};
  for (const row of rows.rows) {
    out[String(row.id)] = {
      blogDayId: String(row.blog_day_id), sortKey: String(row.sort_key), audience: row.audience as BlogAudience,
      authorUserId: String(row.author_user_id), lastEditorUserId: String(row.last_editor_user_id), version: Number(row.version ?? 1),
      caption: row.payload?.caption ?? null, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
  return out;
};

export const updateBlogTextItem = async (userId: string, itemId: string, patch: BlogTextPatch): Promise<BlogTextUpdateResult> => {
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
  if (!updated.rows[0]) {
    // Version mismatch, not a missing item (already ruled out above). Architecture §5.5's
    // autosave conflict contract requires the 409 to carry the latest authorized state so the
    // client's conflict banner can offer "Keep mine" (retry against this exact version) and
    // "Use theirs" (adopt it) without a second round-trip. Re-select rather than trust `row`,
    // which is now stale by definition.
    const latestRow = await queryBlog<any>(
      `SELECT i.*, t.body, t.language_tag, d.local_date FROM blog_items i
       JOIN blog_days d ON d.id = i.blog_day_id JOIN blog_text_contents t ON t.item_id = i.id
       WHERE i.id = $1 AND i.deleted_at IS NULL`,
      [itemId]
    );
    return { conflict: true, latest: latestRow.rows[0] ? mapItem(latestRow.rows[0]) : null };
  }
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

export const setDayCover = async (userId: string, tripId: string, dayDate: string, assetId: string | null): Promise<void> => {
  const access = await ensureUserInTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  const dayId = await getDayId(tripId, dayDate);
  if (assetId) {
    // Plain JOIN, not NOT EXISTS/ANY(uuid[]) — pg-mem (the memory/test adapter) can't run either.
    const match = await queryBlog<{ id: string }>(
      `SELECT a.id FROM blog_media_assets a
       JOIN blog_item_assets ia ON ia.asset_id = a.id
       JOIN blog_items i ON i.id = ia.item_id
       WHERE a.id = $1 AND a.trip_id = $2 AND a.state = 'ready' AND i.blog_day_id = $3
       LIMIT 1`,
      [assetId, tripId, dayId]
    );
    if (!match.rows[0]) throw new Error('That photo or video must belong to this day and be ready before it can be set as the cover');
  }
  await queryBlog(
    'UPDATE blog_days SET cover_asset_id = $2, cover_set_by_user_id = $3, cover_set_at = NOW(), updated_at = NOW() WHERE id = $1',
    [dayId, assetId, userId]
  );
  await queryBlog('UPDATE trip_blogs SET content_revision = content_revision + 1, updated_at = NOW() WHERE trip_id = $1', [tripId]);
};

// Called only after a photo has finalized successfully. The conditional UPDATE makes concurrent
// uploads race-safe: exactly one ready photo can claim an unassigned day, and an existing cover
// (whether automatic or traveler-selected) is never overwritten.
export const setDayCoverIfUnset = async (userId: string, tripId: string, dayDate: string, assetId: string): Promise<boolean> =>
  withBlogTransaction(async (client) => {
    const match = await client.query<{ day_id: string }>(
      `SELECT d.id AS day_id
       FROM blog_media_assets a
       JOIN blog_item_assets ia ON ia.asset_id = a.id
       JOIN blog_items i ON i.id = ia.item_id
       JOIN blog_days d ON d.id = i.blog_day_id
       WHERE a.id = $1 AND a.uploader_user_id = $2 AND a.trip_id = $3
         AND a.media_kind_key = 'photo' AND a.state = 'ready' AND d.local_date = $4::date
       LIMIT 1`,
      [assetId, userId, tripId, dayDate]
    );
    if (!match.rows[0]) return false;

    const updated = await client.query(
      `UPDATE blog_days
       SET cover_asset_id = $2, cover_set_by_user_id = $3, cover_set_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND cover_asset_id IS NULL AND cover_set_at IS NULL
       RETURNING id`,
      [match.rows[0].day_id, assetId, userId]
    );
    if (!updated.rows[0]) return false;
    await client.query(
      'UPDATE trip_blogs SET content_revision = content_revision + 1, updated_at = NOW() WHERE trip_id = $1',
      [tripId]
    );
    return true;
  });

// Minimal BlogDay projection for the day-meta update path: only the fields the conflict banner
// and the headline-editing UI actually need (architecture §5.5, §4.05). `items`/`activities`
// are intentionally empty rather than re-running the full getBlog joins — a day-meta PATCH
// response is not the place to reconstruct the whole day.
const mapDayMeta = (row: any): BlogDay => ({
  id: String(row.id),
  tripId: String(row.trip_id),
  localDate: formatDate(row.local_date),
  headline: row.headline == null ? null : String(row.headline),
  summary: row.summary == null ? null : String(row.summary),
  items: [],
  updateVersion: Number(row.update_version ?? 1),
});

// A6, FR-A3.1: caller-facing display length. Enforced here (not only client-side) because this
// is the same route both the app and any future integration will call.
const MAX_DAY_HEADLINE_LENGTH = 120;
const MAX_DAY_SUMMARY_LENGTH = 500;

export const updateBlogDayMeta = async (
  userId: string,
  tripId: string,
  dayDate: string,
  patch: BlogDayMetaPatch
): Promise<BlogDayMetaUpdateResult> => {
  const access = await ensureUserInTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  if (patch.headline != null && patch.headline.length > MAX_DAY_HEADLINE_LENGTH) {
    throw new Error(`Headline must be ${MAX_DAY_HEADLINE_LENGTH} characters or fewer`);
  }
  if (patch.summary != null && patch.summary.length > MAX_DAY_SUMMARY_LENGTH) {
    throw new Error(`Summary must be ${MAX_DAY_SUMMARY_LENGTH} characters or fewer`);
  }
  const dayId = await getDayId(tripId, dayDate);
  const current = await queryBlog<any>(
    'SELECT id, trip_id, local_date, headline, summary, update_version FROM blog_days WHERE id = $1',
    [dayId]
  );
  if (!current.rows[0]) return null;
  const nextVersion = Number(current.rows[0].update_version ?? 1) + 1;
  const updated = await queryBlog<any>(
    `UPDATE blog_days
     SET headline = CASE WHEN $3 THEN $4 ELSE headline END,
         summary = CASE WHEN $5 THEN $6 ELSE summary END,
         update_version = $2, updated_at = NOW()
     WHERE id = $1 AND update_version = $7
     RETURNING id, trip_id, local_date, headline, summary, update_version`,
    [
      dayId, nextVersion,
      patch.headline !== undefined, patch.headline ?? null,
      patch.summary !== undefined, patch.summary ?? null,
      patch.updateVersion,
    ]
  );
  if (!updated.rows[0]) {
    // Same reasoning as the item-conflict path above: re-select rather than trust `current`,
    // which is stale by the time the conditional UPDATE has already failed.
    const latestRow = await queryBlog<any>(
      'SELECT id, trip_id, local_date, headline, summary, update_version FROM blog_days WHERE id = $1',
      [dayId]
    );
    return { conflict: true, latest: latestRow.rows[0] ? mapDayMeta(latestRow.rows[0]) : null };
  }
  await queryBlog('UPDATE trip_blogs SET content_revision = content_revision + 1, updated_at = NOW() WHERE trip_id = $1', [tripId]);
  return mapDayMeta(updated.rows[0]);
};

// A4: blog masthead (title/subtitle/introduction). No optimistic concurrency here — unlike a
// day's headline, which several travelers edit in parallel while actively writing that day, the
// masthead is edited rarely and by whoever happens to be curating the trip; the architecture and
// PRD documents specify a version contract only for §4.05's day metadata, not the masthead.
const MAX_BLOG_TITLE_LENGTH = 200;
const MAX_BLOG_SUBTITLE_LENGTH = 300;
const MAX_BLOG_INTRODUCTION_LENGTH = 5000;

export const updateBlogMeta = async (userId: string, tripId: string, patch: BlogMastheadPatch): Promise<BlogDocument> => {
  const access = await ensureUserInTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  if (patch.title != null && patch.title.length > MAX_BLOG_TITLE_LENGTH) {
    throw new Error(`Title must be ${MAX_BLOG_TITLE_LENGTH} characters or fewer`);
  }
  if (patch.subtitle != null && patch.subtitle.length > MAX_BLOG_SUBTITLE_LENGTH) {
    throw new Error(`Subtitle must be ${MAX_BLOG_SUBTITLE_LENGTH} characters or fewer`);
  }
  if (patch.introduction != null && patch.introduction.length > MAX_BLOG_INTRODUCTION_LENGTH) {
    throw new Error(`Introduction must be ${MAX_BLOG_INTRODUCTION_LENGTH} characters or fewer`);
  }
  await ensureBlog(tripId);
  const updated = await queryBlog<BlogRow>(
    `UPDATE trip_blogs
     SET title = CASE WHEN $2 THEN $3 ELSE title END,
         subtitle = CASE WHEN $4 THEN $5 ELSE subtitle END,
         introduction = CASE WHEN $6 THEN $7 ELSE introduction END,
         updated_at = NOW()
     WHERE trip_id = $1
     RETURNING *`,
    [
      tripId,
      patch.title !== undefined, patch.title ?? '',
      patch.subtitle !== undefined, patch.subtitle ?? null,
      patch.introduction !== undefined, patch.introduction ?? null,
    ]
  );
  const row = updated.rows[0];
  return {
    id: String(row.id),
    tripId,
    title: String(row.title ?? ''),
    subtitle: row.subtitle == null ? null : String(row.subtitle),
    introduction: row.introduction == null ? null : String(row.introduction),
    contentRevision: Number(row.content_revision ?? 0),
    visibilityState: row.visibility_state,
    visibilityEpoch: Number(row.visibility_epoch ?? 0),
    days: [],
  };
};

export const reorderBlogItems = async (userId: string, tripId: string, itemIds: string[]): Promise<void> => {
  const access = await ensureUserInTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  for (let index = 0; index < itemIds.length; index += 1) {
    await queryBlog('UPDATE blog_items SET sort_key = $3, updated_at = NOW(), last_editor_user_id = $4 WHERE id = $1 AND trip_id = $2 AND deleted_at IS NULL', [itemIds[index], tripId, String(index).padStart(12, '0'), userId]);
  }
  await queryBlog('UPDATE trip_blogs SET content_revision = content_revision + 1, updated_at = NOW() WHERE trip_id = $1', [tripId]);
};

export const getPublicPath = async (tripId: string): Promise<string | null> => {
  const alias = await queryBlog<{ username_slug: string; trip_slug: string }>(
    'SELECT username_slug, trip_slug FROM blog_public_aliases WHERE trip_id = $1 AND canonical = TRUE ORDER BY created_at DESC LIMIT 1',
    [tripId]
  );
  if (alias.rows[0]) return `/${alias.rows[0].username_slug}/${alias.rows[0].trip_slug}`;
  return null;
};

export const isBlogPublic = async (tripId: string): Promise<boolean> => {
  const publicEpoch = await queryBlog(
    "SELECT 1 FROM trip_blogs b JOIN blog_publication_epochs e ON e.trip_id = b.trip_id AND e.state = 'public' WHERE b.trip_id = $1",
    [tripId]
  );
  return Boolean(publicEpoch.rows[0]);
};

export const createModalityItem = async (
  userId: string,
  tripId: string,
  kindKey: string,
  schemaVersion: number,
  audience: string,
  payload: any,
  dayDate: string
): Promise<{ itemId: string; payload: any }> => {
  const day = await queryBlog<any>(
    'SELECT id FROM blog_days WHERE trip_id = $1 AND local_date = $2::date LIMIT 1',
    [tripId, dayDate]
  );
  if (!day.rows[0]) throw new Error('The selected day is outside the trip range');

  const itemId = randomUUID();
  await queryBlog(
    `INSERT INTO blog_items (id, trip_id, blog_day_id, kind_key, schema_version, audience, sort_key, author_user_id, last_editor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [itemId, tripId, day.rows[0].id, kindKey, schemaVersion, audience, `${Date.now()}-${itemId}`, userId]
  );

  const cleanPayload = payload && typeof payload === 'object' ? payload : {};
  await queryBlog('INSERT INTO blog_item_payloads (item_id, payload) VALUES ($1, $2::jsonb)', [
    itemId,
    JSON.stringify(cleanPayload),
  ]);

  return { itemId, payload: cleanPayload };
};

export const searchBlog = async (tripId: string, query: string): Promise<any[]> => {
  const q = `%${query.slice(0, 100)}%`;
  const result = await queryBlog<any>(
    `SELECT i.id, d.local_date, t.body
     FROM blog_items i
     JOIN blog_days d ON d.id = i.blog_day_id
     JOIN blog_text_contents t ON t.item_id = i.id
     WHERE i.trip_id = $1 AND i.deleted_at IS NULL AND t.body ILIKE $2
     ORDER BY d.local_date LIMIT 50`,
    [tripId, q]
  );
  return result.rows;
};
