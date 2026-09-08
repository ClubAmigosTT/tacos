ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS price numeric(8,2) CHECK (price IS NULL OR price >= 0),
  ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS visit_location geography(Point, 4326);

CREATE INDEX IF NOT EXISTS visits_location_gist ON visits USING GIST (visit_location);
CREATE INDEX IF NOT EXISTS visits_price_idx ON visits(price) WHERE price IS NOT NULL;
