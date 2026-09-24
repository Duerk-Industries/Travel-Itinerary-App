-- Portable lodging context used by CSV import/export.
ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE lodgings ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '[]'::jsonb;
