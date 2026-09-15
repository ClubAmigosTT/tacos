ALTER TABLE google_place_candidates
  ADD COLUMN IF NOT EXISTS matched_catalog_status text,
  ADD COLUMN IF NOT EXISTS comparison_version integer NOT NULL DEFAULT 1;

ALTER TABLE google_place_candidates DROP CONSTRAINT IF EXISTS google_place_candidates_status_check;
ALTER TABLE google_place_candidates ADD CONSTRAINT google_place_candidates_status_check
  CHECK (match_status IN ('missing', 'matched', 'matched_unpublished', 'unverified',
                         'review', 'closed_or_obsolete', 'error'));
