ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'visible'
    CHECK (visibility IN ('visible', 'hidden'));

CREATE INDEX IF NOT EXISTS visits_visibility_idx ON visits(visibility, visited_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY,
  reporter_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visit_id uuid NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('spam', 'inappropriate', 'wrong_place', 'other')),
  details text NOT NULL DEFAULT '' CHECK (char_length(details) <= 500),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reporter_id, visit_id)
);

CREATE INDEX IF NOT EXISTS reports_status_idx ON reports(status, created_at DESC);
