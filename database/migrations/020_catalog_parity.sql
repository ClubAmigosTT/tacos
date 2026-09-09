-- Keep the PostgreSQL seed aligned with the mobile fallback catalog.
-- This is idempotent so it is safe on existing Render databases.
INSERT INTO menu_items (id, branch_id, name, note, price, rating, is_active)
VALUES (
  'vilsito-queso',
  'vilsito',
  'Gringa',
  'La opción para cuando vienes con hambre seria.',
  68,
  4.76,
  true
)
ON CONFLICT (id) DO UPDATE SET
  branch_id = EXCLUDED.branch_id,
  name = EXCLUDED.name,
  note = EXCLUDED.note,
  price = EXCLUDED.price,
  rating = EXCLUDED.rating,
  is_active = EXCLUDED.is_active;
