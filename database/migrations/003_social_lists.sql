CREATE TABLE IF NOT EXISTS follows (
  follower_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followed_id),
  CONSTRAINT follows_no_self CHECK (follower_id <> followed_id)
);

CREATE INDEX IF NOT EXISTS follows_followed_idx ON follows(followed_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lists (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 80),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 240),
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  cover_image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lists_owner_idx ON lists(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS lists_public_idx ON lists(visibility, updated_at DESC);

CREATE TABLE IF NOT EXISTS list_items (
  list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  branch_id text NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 240),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, branch_id)
);

CREATE INDEX IF NOT EXISTS list_items_order_idx ON list_items(list_id, position);
