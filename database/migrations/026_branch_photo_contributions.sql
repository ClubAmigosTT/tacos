-- Photos submitted by users and businesses must survive catalog refreshes.
-- Catalog imports keep their own rows separate from moderated contributions.
ALTER TABLE branch_photos
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'catalog',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS uploaded_by text REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS consent_granted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS moderation_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS moderated_by text REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moderated_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_at timestamptz;

ALTER TABLE branch_photos DROP CONSTRAINT IF EXISTS branch_photos_source_type_check;
ALTER TABLE branch_photos
  ADD CONSTRAINT branch_photos_source_type_check
  CHECK (source_type IN ('catalog', 'community', 'owner'));

ALTER TABLE branch_photos DROP CONSTRAINT IF EXISTS branch_photos_status_check;
ALTER TABLE branch_photos
  ADD CONSTRAINT branch_photos_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'removed'));

CREATE INDEX IF NOT EXISTS branch_photos_status_idx
  ON branch_photos(status, created_at DESC);
CREATE INDEX IF NOT EXISTS branch_photos_uploader_idx
  ON branch_photos(uploaded_by, created_at DESC);

-- Existing imported rows are already approved catalog content.
UPDATE branch_photos
SET source_type = COALESCE(source_type, 'catalog'),
    status = COALESCE(status, 'approved')
WHERE source_type IS NULL OR status IS NULL;
