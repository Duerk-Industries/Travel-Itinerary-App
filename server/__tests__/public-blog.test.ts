import request from 'supertest';
import { app } from '../src/app';
import { queryBlog } from '../src/db.postgres';
import { randomUUID } from 'crypto';

describe('Public Blog API', () => {
  let tripId: string;
  let userId: string;

  beforeAll(async () => {
    userId = randomUUID();
    tripId = randomUUID();
    // Seed a trip and a public blog
    await queryBlog('INSERT INTO users (id, email, username) VALUES ($1, $2, $3)', [userId, 'test@example.com', 'testuser']);
    await queryBlog('INSERT INTO trips (id, name, start_date, end_date) VALUES ($1, $2, $3, $4)', [tripId, 'Paris 2026', '2026-05-01', '2026-05-05']);
    await queryBlog('INSERT INTO group_members (id, group_id, user_id) SELECT $1, group_id, $2 FROM trips WHERE id = $3', [randomUUID(), userId, tripId]);
    await queryBlog('INSERT INTO trip_blogs (trip_id, title, visibility_state) VALUES ($1, $2, $3)', [tripId, 'Paris Blog', 'public']);
    await queryBlog('INSERT INTO blog_publication_epochs (id, trip_id, epoch, state, requested_by) VALUES ($1, $2, 1, \'public\', $3)', [randomUUID(), tripId, userId]);
    await queryBlog('INSERT INTO blog_public_aliases (id, trip_id, user_id, username_slug, trip_slug, canonical) VALUES ($1, $2, $3, $4, $5, TRUE)', [randomUUID(), tripId, userId, 'testuser', 'paris-2026']);

    const dayId = randomUUID();
    await queryBlog('INSERT INTO blog_days (id, trip_id, local_date, headline) VALUES ($1, $2, \'2026-05-01\', \'Arrival in Paris\')', [dayId, tripId]);

    const itemId = randomUUID();
    await queryBlog('INSERT INTO blog_items (id, trip_id, blog_day_id, kind_key, audience, sort_key) VALUES ($1, $2, $3, \'core.text\', \'public\', \'001\')', [itemId, tripId, dayId]);
    await queryBlog('INSERT INTO blog_text_contents (item_id, body) VALUES ($1, \'We arrived today!\')', [itemId]);

    // Add an expense (should be hidden)
    await queryBlog('INSERT INTO expenses (id, trip_id, amount, category, expense_date, user_id, group_id) SELECT $1, $2, 100, \'Food\', \'2026-05-01\', $3, group_id FROM trips WHERE id = $2', [randomUUID(), tripId, userId]);
  });

  it('allows anonymous access to a public blog via vanity URL', async () => {
    const res = await request(app).get('/public/blog/testuser/paris-2026');
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Paris Blog');
    expect(res.body.days[0].headline).toBe('Arrival in Paris');
    expect(res.body.days[0].items[0].body).toBe('We arrived today!');
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
