-- Preserve existing branch data when the normalized parent model is introduced
-- or when a database was seeded with branches outside the demo catalog.
INSERT INTO taquerias (id, name, slug, description)
SELECT b.taqueria_id,
  MIN(b.name) AS name,
  'taqueria-' || md5(b.taqueria_id) AS slug,
  'Taquería importada; completa sus datos desde el panel de catálogo.' AS description
FROM branches b
WHERE b.taqueria_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM taquerias t WHERE t.id = b.taqueria_id)
GROUP BY b.taqueria_id
ON CONFLICT (id) DO NOTHING;
