CREATE TABLE IF NOT EXISTS saved_places (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id text NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, branch_id)
);

CREATE INDEX IF NOT EXISTS saved_places_user_idx ON saved_places(user_id, created_at DESC);
