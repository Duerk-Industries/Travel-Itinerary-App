import { getCurrentDbProvider } from '../db';
import * as postgres from './postgresEngagementRepository';
import * as firebase from './firebaseEngagementRepository';

// Mirrors blog/repository.ts exactly: 'firebase' gets the Firestore-backed implementation,
// everything else (postgres, and memory — pg-mem runs the same SQL through the same queryBlog
// pool as real Postgres) gets the Postgres implementation.
export interface BlogEngagementRepository {
  upsertReaction: typeof postgres.upsertReaction;
  clearReaction: typeof postgres.clearReaction;
  getEngagementSummaries: typeof postgres.getEngagementSummaries;
  listReactors: typeof postgres.listReactors;
  createComment: typeof postgres.createComment;
  getCommentById: typeof postgres.getCommentById;
  updateCommentBody: typeof postgres.updateCommentBody;
  softDeleteComment: typeof postgres.softDeleteComment;
  hideComment: typeof postgres.hideComment;
  unhideComment: typeof postgres.unhideComment;
  reportComment: typeof postgres.reportComment;
  getStrikeState: typeof postgres.getStrikeState;
  incrementStrike: typeof postgres.incrementStrike;
  listTopLevelCommentsForDay: typeof postgres.listTopLevelCommentsForDay;
  listReplies: typeof postgres.listReplies;
}

export const blogEngagementRepository = (): BlogEngagementRepository =>
  getCurrentDbProvider() === 'firebase' ? (firebase as unknown as BlogEngagementRepository) : (postgres as unknown as BlogEngagementRepository);
