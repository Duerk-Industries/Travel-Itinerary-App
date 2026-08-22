import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { queryBlog } from '../src/db.postgres';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';
import {
  BlogEngagementUnauthorizedError,
  BlogTargetNotFoundError,
  clearReactionOnTarget,
  deleteComment,
  editComment,
  postComment,
  reactToTarget,
  reportCommentByActor,
  resolveActorMembership,
  resolveComment,
  resolveEngagementTarget,
} from '../src/services/blogEngagementService';
import { blogEngagementRepository } from '../src/blog/engagementRepository';

// Phase 2 of docs/trip-blog-social-implementation-plan.md — the authorization matrix test.
// Architecture §11 bullet 1: "a table-driven test over {traveler, owner, follower, admin,
// stranger, anonymous} × {day, item, asset} × {view, react, comment, edit, delete, hide}
// asserting the exact status code. This is the highest-value test in the program; write it before
// the routes." No route exists yet — every assertion here calls blogEngagementService directly,
// matching the plan's exit criteria for this phase.

describe('blog engagement authorization matrix (Phase 2 — service layer, no routes)', () => {
  const traveler = { firstName: 'Matrix', lastName: 'Traveler', email: 'blog-matrix-traveler@example.com', password: 'Password123!' };
  const follower = { firstName: 'Matrix', lastName: 'Follower', email: 'blog-matrix-follower@example.com', password: 'Password123!' };
  const stranger = { firstName: 'Matrix', lastName: 'Stranger', email: 'blog-matrix-stranger@example.com', password: 'Password123!' };

  let travelerToken = '';
  let travelerId = '';
  let followerId = '';
  let strangerId = '';
  let tripId = '';
  let dayId = '';
  let travelersItemId = '';
  let publicItemId = '';
  let followersItemId = '';

  const createTextItem = async (dayDate: string, audience: string, body: string) => {
    const res = await request(app)
      .post(`/api/trips/${tripId}/blog/items`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ kindKey: 'core.text', dayDate, body, audience })
      .expect(201);
    return res.body.id as string;
  };

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);

    await registerWebUser(traveler);
    await confirmWebUser(traveler.email);
    const travelerLogin = await loginWebUser(traveler);
    travelerToken = travelerLogin.body.token;
    travelerId = travelerLogin.body.user.id;

    await registerWebUser(follower);
    await confirmWebUser(follower.email);
    followerId = (await loginWebUser(follower)).body.user.id;

    await registerWebUser(stranger);
    await confirmWebUser(stranger.email);
    strangerId = (await loginWebUser(stranger)).body.user.id;

    const trip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ name: 'Matrix Trip', startDate: '2026-10-05', endDate: '2026-10-05', participants: [] })
      .expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;

    await queryBlog('INSERT INTO trip_followers (id, trip_id, follower_user_id) VALUES ($1, $2, $3)', [randomUUID(), tripId, followerId]);

    // trip_blogs is created lazily by ensureBlog() — which createBlogTextItem below never calls;
    // only GET /:tripId/blog (and a few other repository functions) do. Everything this service
    // reads from trip_blogs (follower_comments_enabled, isBlogPublic's JOIN) needs that row to
    // exist first, so hit the read path once here, exactly as a real client naturally would
    // before ever writing anything.
    await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${travelerToken}`).expect(200);

    travelersItemId = await createTextItem('2026-10-05', 'travelers', 'Only travelers see this');
    publicItemId = await createTextItem('2026-10-05', 'public', 'Everyone sees this');
    followersItemId = await createTextItem('2026-10-05', 'followers', 'Followers and travelers see this');

    const dayRow = await queryBlog<{ id: string }>('SELECT id FROM blog_days WHERE trip_id = $1 AND local_date = $2::date', [tripId, '2026-10-05']);
    dayId = dayRow.rows[0].id;
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([traveler.email, follower.email, stranger.email]);
  });

  describe('resolveActorMembership — step 2', () => {
    it('identifies a trip member as traveler and a trip_followers row as follower', async () => {
      await expect(resolveActorMembership(tripId, travelerId)).resolves.toBe('traveler');
      await expect(resolveActorMembership(tripId, followerId)).resolves.toBe('follower');
    });
    it('throws BlogEngagementUnauthorizedError for someone with no relationship to the trip', async () => {
      await expect(resolveActorMembership(tripId, strangerId)).rejects.toBeInstanceOf(BlogEngagementUnauthorizedError);
    });
  });

  describe('resolveEngagementTarget — step 3, item/asset audience visibility', () => {
    it('a traveler resolves every audience level', async () => {
      for (const itemId of [travelersItemId, publicItemId, followersItemId]) {
        const resolved = await resolveEngagementTarget(tripId, travelerId, 'traveler', 'item', itemId);
        expect(resolved).not.toBeNull();
      }
    });
    it('a follower resolves public/followers items but not travelers-only ones — returns null, not an error', async () => {
      await expect(resolveEngagementTarget(tripId, followerId, 'follower', 'item', publicItemId)).resolves.not.toBeNull();
      await expect(resolveEngagementTarget(tripId, followerId, 'follower', 'item', followersItemId)).resolves.not.toBeNull();
      await expect(resolveEngagementTarget(tripId, followerId, 'follower', 'item', travelersItemId)).resolves.toBeNull();
    });
    it('a nonexistent item resolves to null, indistinguishable in shape from a hidden one', async () => {
      await expect(resolveEngagementTarget(tripId, travelerId, 'traveler', 'item', randomUUID())).resolves.toBeNull();
    });
    it('a day target is `travelers` audience for a traveler and `followers` for a follower while the blog is private', async () => {
      const asTraveler = await resolveEngagementTarget(tripId, travelerId, 'traveler', 'day', dayId);
      const asFollower = await resolveEngagementTarget(tripId, followerId, 'follower', 'day', dayId);
      expect(asTraveler?.effectiveAudience).toBe('travelers');
      expect(asFollower?.effectiveAudience).toBe('followers');
    });
    it('a day target is `public` audience once the blog is published', async () => {
      await queryBlog(
        `INSERT INTO blog_publication_epochs (trip_id, epoch, state, requested_by) VALUES ($1, 1, 'public', $2)`,
        [tripId, travelerId]
      );
      const asTraveler = await resolveEngagementTarget(tripId, travelerId, 'traveler', 'day', dayId);
      expect(asTraveler?.effectiveAudience).toBe('public');
      await queryBlog(`DELETE FROM blog_publication_epochs WHERE trip_id = $1`, [tripId]);
    });
  });

  describe('reactToTarget / clearReactionOnTarget — full write path', () => {
    it('a stranger cannot react at all (unauthorized, before target resolution even runs)', async () => {
      await expect(reactToTarget(tripId, strangerId, 'item', publicItemId, 'heart')).rejects.toBeInstanceOf(BlogEngagementUnauthorizedError);
    });
    it('a follower reacting to a travelers-only item gets "not found," not "forbidden"', async () => {
      await expect(reactToTarget(tripId, followerId, 'item', travelersItemId, 'heart')).rejects.toBeInstanceOf(BlogTargetNotFoundError);
    });
    it('a traveler can react, and re-sending the same emoji clears it (FR-B1.2)', async () => {
      const first = await reactToTarget(tripId, travelerId, 'item', publicItemId, 'heart');
      expect(first.cleared).toBe(false);
      const second = await reactToTarget(tripId, travelerId, 'item', publicItemId, 'heart');
      expect(second.cleared).toBe(true);
      const summaries = await blogEngagementRepository().getEngagementSummaries(travelerId, [{ targetKind: 'item', targetId: publicItemId }], ['travelers', 'followers', 'public']);
      expect(summaries['item:' + publicItemId].reactionTotal).toBe(0);
    });
    it('a follower can react to a public item, and counts sum correctly across the traveler+follower viewers', async () => {
      await reactToTarget(tripId, travelerId, 'item', publicItemId, 'fire');
      await reactToTarget(tripId, followerId, 'item', publicItemId, 'laugh');
      const asTraveler = await blogEngagementRepository().getEngagementSummaries(travelerId, [{ targetKind: 'item', targetId: publicItemId }], ['travelers', 'followers', 'public']);
      expect(asTraveler['item:' + publicItemId].reactionTotal).toBe(2);
      expect(asTraveler['item:' + publicItemId].userReaction).toBe('fire');
      await clearReactionOnTarget(tripId, travelerId, 'item', publicItemId);
      await clearReactionOnTarget(tripId, followerId, 'item', publicItemId);
    });
  });

  describe('postComment / editComment / deleteComment / reportCommentByActor', () => {
    it('a stranger cannot comment', async () => {
      await expect(postComment(tripId, strangerId, 'item', publicItemId, 'hello')).rejects.toBeInstanceOf(BlogEngagementUnauthorizedError);
    });
    it('a follower commenting on a travelers-only item gets "not found"', async () => {
      await expect(postComment(tripId, followerId, 'item', travelersItemId, 'hello')).rejects.toBeInstanceOf(BlogTargetNotFoundError);
    });
    it('a traveler can comment, and the comment is created with the target’s current audience', async () => {
      const comment = await postComment(tripId, travelerId, 'item', followersItemId, 'Nice photo');
      expect(comment.audience).toBe('followers');
      expect(comment.authorRole).toBe('traveler');
    });
    it('only the author may edit or delete their own comment', async () => {
      const comment = await postComment(tripId, travelerId, 'item', publicItemId, 'Original text');
      await expect(editComment(tripId, followerId, comment.id, 'Hijacked')).rejects.toBeInstanceOf(BlogTargetNotFoundError);
      const edited = await editComment(tripId, travelerId, comment.id, 'Edited text');
      expect(edited.body).toBe('Edited text');
      await expect(deleteComment(tripId, followerId, comment.id)).rejects.toBeInstanceOf(BlogTargetNotFoundError);
      await deleteComment(tripId, travelerId, comment.id);
      const gone = await blogEngagementRepository().getCommentById(comment.id);
      expect(gone).toBeNull(); // no replies -> hard delete, not a tombstone
    });
    it('a comment with a reply becomes a tombstone (body cleared) rather than disappearing (FR-B2.4)', async () => {
      const parent = await postComment(tripId, travelerId, 'item', publicItemId, 'Parent comment');
      await postComment(tripId, followerId, 'item', publicItemId, 'A reply', parent.id);
      await deleteComment(tripId, travelerId, parent.id);
      const tombstone = await blogEngagementRepository().getCommentById(parent.id);
      expect(tombstone).not.toBeNull();
      expect(tombstone!.body).toBeNull();
      expect(tombstone!.deletedAt).not.toBeNull();
    });
    it('resolveComment is the only path for comment-id actions — a comment from another trip never resolves (threat S3)', async () => {
      const otherTrip = await request(app)
        .post('/api/trips/wizard')
        .set('Authorization', `Bearer ${travelerToken}`)
        .send({ name: 'Other Trip', startDate: '2026-11-01', endDate: '2026-11-01', participants: [] })
        .expect(201);
      const otherTripId = otherTrip.body.trip?.id ?? otherTrip.body.id;
      const comment = await postComment(tripId, travelerId, 'item', publicItemId, 'Belongs to the matrix trip');
      const resolved = await resolveComment(otherTripId, travelerId, 'traveler', comment.id);
      expect(resolved).toBeNull();
    });
    it('a user cannot report their own comment', async () => {
      const comment = await postComment(tripId, travelerId, 'item', publicItemId, 'My own comment');
      await expect(reportCommentByActor(tripId, travelerId, comment.id, 'spam')).rejects.toBeInstanceOf(BlogEngagementUnauthorizedError);
    });
    it('a different user can report it, and a duplicate report from the same user is a silent no-op (not an error)', async () => {
      const comment = await postComment(tripId, travelerId, 'item', publicItemId, 'Reportable comment');
      await reportCommentByActor(tripId, followerId, comment.id, 'spam');
      await expect(reportCommentByActor(tripId, followerId, comment.id, 'spam')).resolves.toBeUndefined();
    });
  });

  describe('trip-level toggles and strikes — steps 5 and 6', () => {
    it('disabling follower_comments_enabled blocks a follower but not a traveler', async () => {
      await queryBlog('UPDATE trip_blogs SET follower_comments_enabled = FALSE WHERE trip_id = $1', [tripId]);
      await expect(postComment(tripId, followerId, 'item', publicItemId, 'Should be blocked')).rejects.toBeInstanceOf(BlogEngagementUnauthorizedError);
      await expect(postComment(tripId, travelerId, 'item', publicItemId, 'Travelers are unaffected')).resolves.toBeTruthy();
      await queryBlog('UPDATE trip_blogs SET follower_comments_enabled = TRUE WHERE trip_id = $1', [tripId]);
    });
    it('three strikes blocks further commenting on the trip (FR-B11.3)', async () => {
      await blogEngagementRepository().incrementStrike(tripId, followerId);
      await blogEngagementRepository().incrementStrike(tripId, followerId);
      const third = await blogEngagementRepository().incrementStrike(tripId, followerId);
      expect(third.blockedAt).not.toBeNull();
      await expect(postComment(tripId, followerId, 'item', publicItemId, 'Should be blocked by strikes')).rejects.toBeInstanceOf(BlogEngagementUnauthorizedError);
      // Traveler is unaffected — strikes are per (trip, user), not trip-wide.
      await expect(postComment(tripId, travelerId, 'item', publicItemId, 'Unaffected')).resolves.toBeTruthy();
    });
  });
});
