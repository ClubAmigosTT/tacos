ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS visits_updated_idx ON visits(user_id, updated_at DESC);
