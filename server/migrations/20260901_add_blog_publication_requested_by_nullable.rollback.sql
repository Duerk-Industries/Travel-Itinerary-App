-- Rollback for 20260901_add_blog_publication_requested_by_nullable.sql. Reinstating NOT NULL will
-- fail if any row has been nulled out by an account deletion since this migration ran — that is
-- expected and correct: the rollback cannot silently reattribute a deleted account's request to
-- someone else, so it must be applied before any such deletion, or those rows fixed up manually.
ALTER TABLE blog_publication_epochs DROP CONSTRAINT IF EXISTS blog_publication_epochs_requested_by_fkey;
ALTER TABLE blog_publication_epochs DROP CONSTRAINT IF EXISTS blog_publication_epochs_requested_by_fk;
ALTER TABLE blog_publication_epochs ADD CONSTRAINT blog_publication_epochs_requested_by_fkey
  FOREIGN KEY (requested_by) REFERENCES users(id);
ALTER TABLE blog_publication_epochs ALTER COLUMN requested_by SET NOT NULL;
