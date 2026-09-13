-- Catalog quality and community proposals.
-- A catalog score is optional: a new place must not look personally ranked
-- before there is enough evidence to calculate that ranking.
ALTER TABLE branches
  ALTER COLUMN match_score DROP NOT NULL,
  ALTER COLUMN match_score DROP DEFAULT;

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS catalog_quality text NOT NULL DEFAULT 'catalog',
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;

ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_catalog_quality_check;
ALTER TABLE branches ADD CONSTRAINT branches_catalog_quality_check
  CHECK (catalog_quality IN ('catalog', 'community', 'verified'));

CREATE TABLE IF NOT EXISTS catalog_proposals (
  id uuid PRIMARY KEY,
  proposer_id text REFERENCES users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('branch', 'menu_item', 'correction')),
  branch_id text REFERENCES branches(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_url text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note text NOT NULL DEFAULT '',
  reviewed_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_proposals_status_idx
  ON catalog_proposals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS catalog_proposals_branch_idx
  ON catalog_proposals(branch_id, created_at DESC);
