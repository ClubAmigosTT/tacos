-- Google Place IDs are kept only as reconciliation candidates.
-- We do not mirror Google names, addresses, photos or reviews into our catalog.
-- Place IDs can be stored for reconciliation, while the catalog remains sourced
-- from DENUE/OSM and community data.
CREATE TABLE IF NOT EXISTS google_place_candidates (
  google_place_id text PRIMARY KEY,
  search_region text NOT NULL,
  search_area text NOT NULL,
  search_query text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz,
  matched_branch_id text REFERENCES branches(id) ON DELETE SET NULL,
  match_status text NOT NULL DEFAULT 'missing',
  match_confidence numeric(5,4),
  match_method text,
  last_error text
);

ALTER TABLE google_place_candidates DROP CONSTRAINT IF EXISTS google_place_candidates_status_check;
ALTER TABLE google_place_candidates
  ADD CONSTRAINT google_place_candidates_status_check
  CHECK (match_status IN ('missing', 'matched', 'review', 'closed_or_obsolete', 'error'));

ALTER TABLE google_place_candidates DROP CONSTRAINT IF EXISTS google_place_candidates_confidence_check;
ALTER TABLE google_place_candidates
  ADD CONSTRAINT google_place_candidates_confidence_check
  CHECK (match_confidence IS NULL OR (match_confidence >= 0 AND match_confidence <= 1));

CREATE INDEX IF NOT EXISTS google_place_candidates_status_idx
  ON google_place_candidates(search_region, match_status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS google_place_candidates_branch_idx
  ON google_place_candidates(matched_branch_id);
