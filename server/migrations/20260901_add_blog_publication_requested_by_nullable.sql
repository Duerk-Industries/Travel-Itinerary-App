-- Phase 4 of docs/trip-blog-social-implementation-plan.md — discovered while building the
-- account-deletion scrub (db.postgres.ts's deleteWebUserAndCleanup): blog_publication_epochs.
-- requested_by (from 20260723_add_trip_blog_publication.sql) referenced users(id) with no ON
-- DELETE behavior at all, which meant any account that had ever requested a blog publication
-- could never be deleted afterward — the DELETE FROM users statement would fail its own foreign
-- key check, in real Postgres as much as in the pg-mem test double. requested_by is an audit/
-- attribution field, not something anything joins against expecting a live row, so it becomes
-- nullable and ON DELETE SET NULL, matching hidden_by_user_id's treatment in the blog engagement
-- migration for the same reason.
--
-- The original FK was declared inline (`REFERENCES users(id)`), so its auto-generated name is
-- whatever the running engine happens to assign — real Postgres uses
-- `blog_publication_epochs_requested_by_fkey`, but pg-mem (this repo's test double) assigns
-- `blog_publication_epochs_requested_by_fk`, one character short. A PL/pgSQL DO block could look
-- this up dynamically, but pg-mem does not support DO blocks/PL/pgSQL at all ("Unknown language
-- plpgsql") — so both known names are dropped explicitly instead; IF EXISTS makes the one that
-- doesn't apply to the running engine a no-op.
ALTER TABLE blog_publication_epochs DROP CONSTRAINT IF EXISTS blog_publication_epochs_requested_by_fkey;
ALTER TABLE blog_publication_epochs DROP CONSTRAINT IF EXISTS blog_publication_epochs_requested_by_fk;
ALTER TABLE blog_publication_epochs ALTER COLUMN requested_by DROP NOT NULL;
ALTER TABLE blog_publication_epochs ADD CONSTRAINT blog_publication_epochs_requested_by_fkey
  FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL;
