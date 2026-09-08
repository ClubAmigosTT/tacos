ALTER TABLE visit_items
  ADD COLUMN IF NOT EXISTS rating numeric(2,1) CHECK (rating BETWEEN 1 AND 5);

CREATE INDEX IF NOT EXISTS visit_items_rating_idx ON visit_items(menu_item_id, rating) WHERE rating IS NOT NULL;
