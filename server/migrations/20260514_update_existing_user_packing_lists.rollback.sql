-- No-op rollback.
-- This migration only appends missing default packing-list items to existing
-- user packing lists. Removing those rows on rollback would risk deleting
-- items a user has since edited or intentionally kept.
UPDATE user_packing_list_items
SET position = position
WHERE FALSE;
