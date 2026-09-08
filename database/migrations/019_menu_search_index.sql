CREATE INDEX IF NOT EXISTS menu_items_name_trgm
  ON menu_items USING GIN (name gin_trgm_ops)
  WHERE is_active = true;
