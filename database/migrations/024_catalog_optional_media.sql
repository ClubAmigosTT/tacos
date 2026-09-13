-- A discovered place can be useful before a licensed photograph is available.
-- Keep the column for backwards compatibility, but allow a missing image and
-- let the mobile client render its own branded fallback.
ALTER TABLE branches ALTER COLUMN image_url DROP NOT NULL;
