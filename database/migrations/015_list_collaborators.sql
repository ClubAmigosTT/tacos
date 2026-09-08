CREATE TABLE IF NOT EXISTS list_collaborators (
  list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'editor' CHECK (role IN ('editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, user_id),
  CONSTRAINT list_collaborator_not_owner CHECK (user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS list_collaborators_user_idx ON list_collaborators(user_id, created_at DESC);
