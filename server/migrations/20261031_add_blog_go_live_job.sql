-- Seeds the lease row for the go-live-at-trip-start job (blogBackgroundWorker.ts's runGoLiveJob).
-- claimLease only ever UPDATEs an existing blog_worker_leases row, so without this row the job
-- would silently no-op (see 20260914_add_blog_day_photo_reminder_job.sql).
INSERT INTO blog_worker_leases (job_key)
VALUES ('blog:go_live')
ON CONFLICT DO NOTHING;
