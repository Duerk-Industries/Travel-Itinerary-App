-- Trip-level opt-in for the end-of-day "add a photo" reminder (runDayPhotoReminderJob in
-- blogBackgroundWorker.ts). Off by default and deliberately fail-closed (unlike
-- follower_comments_enabled's fail-open `!== false` read) — a trip must explicitly turn this on
-- before any of its travelers can be nudged, on top of each traveler's own notification
-- preference (notificationService.ts's DEFAULT_PREFERENCES defaults blog_day_photo_reminder to
-- off on every channel for the same reason).
ALTER TABLE trip_blogs ADD COLUMN IF NOT EXISTS day_photo_reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE;
