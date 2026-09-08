CREATE TABLE IF NOT EXISTS product_events (
  id bigserial PRIMARY KEY,
  event_name text NOT NULL CHECK (event_name ~ '^[a-z0-9_.-]{1,64}$'),
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  anonymous_id text CHECK (anonymous_id IS NULL OR anonymous_id ~ '^[a-zA-Z0-9._:-]{8,128}$'),
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_events_name_created_idx ON product_events(event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS product_events_user_created_idx ON product_events(user_id, created_at DESC);
