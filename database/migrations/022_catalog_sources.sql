-- Catalog records are imported from an attributed, licensed source instead
-- of being treated as hand-written demo fixtures. Keep the raw provenance so
-- every photo and field can be audited or refreshed independently.
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS weekly_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS price_min numeric(8,2),
  ADD COLUMN IF NOT EXISTS price_max numeric(8,2),
  ADD COLUMN IF NOT EXISTS image_license text,
  ADD COLUMN IF NOT EXISTS image_attribution text,
  ADD COLUMN IF NOT EXISTS image_source_url text,
  ADD COLUMN IF NOT EXISTS source_name text,
  ADD COLUMN IF NOT EXISTS source_place_id text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS source_license text,
  ADD COLUMN IF NOT EXISTS source_attribution text,
  ADD COLUMN IF NOT EXISTS source_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS catalog_status text NOT NULL DEFAULT 'active';

ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_catalog_status_check;
ALTER TABLE branches ADD CONSTRAINT branches_catalog_status_check CHECK (catalog_status IN ('active', 'needs_review', 'archived'));
CREATE UNIQUE INDEX IF NOT EXISTS branches_source_place_uidx ON branches(source_name, source_place_id) WHERE source_name IS NOT NULL AND source_place_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS branches_dedupe_key_uidx ON branches(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS branches_catalog_status_idx ON branches(catalog_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS branch_photos (
  id uuid PRIMARY KEY,
  branch_id text NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  url text NOT NULL,
  source_url text,
  license text NOT NULL,
  attribution text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS branch_photos_branch_idx ON branch_photos(branch_id, is_primary DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS catalog_imports (
  id uuid PRIMARY KEY,
  source_name text NOT NULL,
  source_url text,
  source_license text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  records_seen integer NOT NULL DEFAULT 0,
  records_upserted integer NOT NULL DEFAULT 0,
  duplicates_flagged integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- Existing demo rows remain queryable for local design review, but are clearly
-- marked as demo data so the importer can replace/archive them atomically.
UPDATE branches SET source_name = COALESCE(source_name, 'demo'), catalog_status = COALESCE(catalog_status, 'active') WHERE source_name IS NULL;
