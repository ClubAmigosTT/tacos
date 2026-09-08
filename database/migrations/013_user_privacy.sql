ALTER TABLE users
  ADD COLUMN IF NOT EXISTS share_activity boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS users_activity_idx ON users(share_activity) WHERE share_activity = true;
