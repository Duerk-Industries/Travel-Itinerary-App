-- Public-by-default trip blogs. A blog is auto-published for public viewing only when every
-- traveler has a date of birth showing 16+, no traveler's profile default is private
-- (users.blog_default_public) and no traveler has made this trip's blog private
-- (trip_blogs.public_opt_out). Travelers and followers can always see the blog regardless.
ALTER TABLE users ADD COLUMN IF NOT EXISTS blog_default_public BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE trip_blogs ADD COLUMN IF NOT EXISTS public_opt_out BOOLEAN NOT NULL DEFAULT FALSE;
