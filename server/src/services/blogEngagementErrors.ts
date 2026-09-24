// Shared by blogEngagementService.ts and blogModerationService.ts. Split out to a dedicated
// module rather than exported from blogEngagementService.ts itself: Phase 4's postComment needs
// to call blogModerationService.checkSpam, and blogModerationService's hide/unhide need these two
// error classes — importing them from blogEngagementService.ts directly would make the two files
// import each other (a circular dependency that happens to work today, since both usages are
// inside function bodies rather than at module-eval time, but is not worth relying on).

export class BlogEngagementUnauthorizedError extends Error {
  constructor(message = 'Not authorized on this trip') {
    super(message);
    this.name = 'BlogEngagementUnauthorizedError';
  }
}

// Distinguishes "target does not exist, or isn't visible to this actor" from "actor has no
// relationship to this trip at all" (BlogEngagementUnauthorizedError above). The two map to
// different HTTP statuses at the route layer — 404 vs 403 — which is exactly the distinction
// architecture §4 step 3 requires ("the endpoint does not confirm the item exists").
export class BlogTargetNotFoundError extends Error {
  constructor(message = 'That day, note, photo or video was not found on this trip') {
    super(message);
    this.name = 'BlogTargetNotFoundError';
  }
}
