-- Seeds the lease row for the new end-of-day "add a photo" reminder job
-- (blogBackgroundWorker.ts's runDayPhotoReminderJob). claimLease/claimLeaseFirebase only ever
-- UPDATE an existing blog_worker_leases row (see 20260901_add_blog_background_jobs.sql's own seed
-- INSERT for the same reason) — without this row the job silently no-ops forever, never even
-- logging an error, since claimLease's WHERE job_key = $4 simply matches zero rows.
INSERT INTO blog_worker_leases (job_key)
VALUES ('blog:day_photo_reminder')
ON CONFLICT DO NOTHING;
