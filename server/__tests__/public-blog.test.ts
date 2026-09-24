import request from 'supertest';
import { app } from '../src/app';
import { initDb } from '../src/db';
import { queryBlog } from '../src/db.postgres';
import { randomUUID } from 'crypto';

// The real client would hit GCS; here we just confirm the route calls it with the rendition
// naming convention and puts the result on the response, without exercising real storage.
jest.mock('../src/services/blogStorageClient', () => ({
  createBlogReadUrl: jest.fn(async (objectKey: string) => `https://signed.test/${objectKey}`),
  blogRenditionKey: (uploaderUserId: string, assetId: string, rendition: string) => `trip-blog/${uploaderUserId}/${assetId}/${rendition}`,
}));

describe('Public Blog API', () => {
  let tripId: string;
  let userId: string;

  beforeAll(async () => {
    await initDb();
    userId = randomUUID();
    tripId = randomUUID();
    const groupId = randomUUID();
    // Seed a trip and a public blog
    await queryBlog('INSERT INTO users (id, email, username, provider) VALUES ($1, $2, $3, $4)', [userId, 'test@example.com', 'testuser', 'email']);
    await queryBlog('INSERT INTO groups (id, name, owner_id) VALUES ($1, $2, $3)', [groupId, 'Test Group', userId]);
    await queryBlog('INSERT INTO trips (id, name, group_id, start_date, end_date) VALUES ($1, $2, $3, $4, $5)', [tripId, 'Paris 2026', groupId, '2026-05-01', '2026-05-05']);
    await queryBlog('INSERT INTO group_members (id, group_id, user_id, added_by) VALUES ($1, $2, $3, $3)', [randomUUID(), groupId, userId]);
    await queryBlog('INSERT INTO trip_blogs (trip_id, title, visibility_state) VALUES ($1, $2, $3)', [tripId, 'Paris Blog', 'public']);
    await queryBlog('INSERT INTO blog_publication_epochs (id, trip_id, epoch, state, requested_by) VALUES ($1, $2, 1, \'public\', $3)', [randomUUID(), tripId, userId]);
    await queryBlog('INSERT INTO blog_public_aliases (id, trip_id, user_id, username_slug, trip_slug, canonical) VALUES ($1, $2, $3, $4, $5, TRUE)', [randomUUID(), tripId, userId, 'testuser', 'paris-2026']);

    const dayId = randomUUID();
    await queryBlog('INSERT INTO blog_days (id, trip_id, local_date, headline) VALUES ($1, $2, \'2026-05-01\', \'Arrival in Paris\')', [dayId, tripId]);

    const itemId = randomUUID();
    await queryBlog('INSERT INTO blog_items (id, trip_id, blog_day_id, kind_key, audience, sort_key, author_user_id, last_editor_user_id) VALUES ($1, $2, $3, \'core.text\', \'public\', \'001\', $4, $4)', [itemId, tripId, dayId, userId]);
    await queryBlog('INSERT INTO blog_text_contents (item_id, body) VALUES ($1, \'We arrived today!\')', [itemId]);

    // A public photo, so the response's media-URL-signing path (attachPublicMediaUrls) is exercised.
    const photoItemId = randomUUID();
    const assetId = randomUUID();
    await queryBlog('INSERT INTO blog_items (id, trip_id, blog_day_id, kind_key, audience, sort_key, author_user_id, last_editor_user_id) VALUES ($1, $2, $3, \'media.photo\', \'public\', \'002\', $4, $4)', [photoItemId, tripId, dayId, userId]);
    await queryBlog(
      `INSERT INTO blog_media_assets (id, trip_id, uploader_user_id, storage_account_user_id, media_kind_key, state, object_key, physical_bytes, billable_bytes)
       VALUES ($1, $2, $3, $3, 'photo', 'ready', $4, 1, 1)`,
      [assetId, tripId, userId, `trip-blog/${userId}/${assetId}/source`]
    );
    await queryBlog('INSERT INTO blog_item_assets (item_id, asset_id, position) VALUES ($1, $2, 0)', [photoItemId, assetId]);

    // Add an expense (should be hidden)
    await queryBlog('INSERT INTO expenses (id, trip_id, amount, category, expense_date, user_id, group_id) SELECT $1, $2, 100, \'Food\', $3::date, $4, group_id FROM trips WHERE id = $2', [randomUUID(), tripId, '2026-05-01', userId]);
  });

  it('allows anonymous access to a public blog via vanity URL', async () => {
    const res = await request(app).get('/public/blog/testuser/paris-2026');
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Paris Blog');
    expect(res.body.days[0].headline).toBe('Arrival in Paris');
    expect(res.body.days[0].items[0].body).toBe('We arrived today!');
  });

  it('signs a URL for a public photo and never exposes its storage object key or uploader', async () => {
    const res = await request(app).get('/public/blog/testuser/paris-2026');
    const photoItem = res.body.days[0].items.find((item: any) => item.mediaKind === 'photo');
    expect(photoItem).toBeTruthy();
    expect(photoItem.primaryUrl).toMatch(/^https:\/\/signed\.test\//);
    expect(photoItem.thumbnailUrl).toMatch(/^https:\/\/signed\.test\//);
    expect(photoItem.objectKey).toBeUndefined();
    expect(photoItem.uploaderUserId).toBeUndefined();
  });

  it('does not expose expense or cost data in public response', async () => {
    const res = await request(app).get('/public/blog/testuser/paris-2026');
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('100');
    expect(json).not.toContain('Food');
    expect(res.body.expenses).toBeUndefined();
    expect(res.body.costs).toBeUndefined();
  });

  it('returns 404 for non-existent or private blogs', async () => {
    const res = await request(app).get('/public/blog/nobody/nowhere');
    expect(res.status).toBe(404);
  });
});
