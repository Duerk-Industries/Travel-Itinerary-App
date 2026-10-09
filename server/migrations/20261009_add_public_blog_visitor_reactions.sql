-- Public readers can react without creating an account. A random per-blog browser UUID
-- identifies one changeable reaction per visitor and target; it is never returned publicly.
ALTER TABLE blog_reactions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE blog_reactions ADD COLUMN IF NOT EXISTS visitor_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_blog_reactions_visitor_day
  ON blog_reactions(blog_day_id, visitor_id)
  WHERE blog_day_id IS NOT NULL AND visitor_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_blog_reactions_visitor_item
  ON blog_reactions(blog_item_id, visitor_id)
  WHERE blog_item_id IS NOT NULL AND visitor_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_blog_reactions_visitor_asset
  ON blog_reactions(asset_id, visitor_id)
  WHERE asset_id IS NOT NULL AND visitor_id IS NOT NULL;
