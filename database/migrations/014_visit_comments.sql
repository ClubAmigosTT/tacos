CREATE TABLE IF NOT EXISTS visit_comments (
  id uuid PRIMARY KEY,
  visit_id uuid NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  author_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  visibility text NOT NULL DEFAULT 'visible' CHECK (visibility IN ('visible', 'hidden')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visit_comments_visit_idx ON visit_comments(visit_id, created_at ASC) WHERE visibility = 'visible';
CREATE INDEX IF NOT EXISTS visit_comments_author_idx ON visit_comments(author_id, created_at DESC);
