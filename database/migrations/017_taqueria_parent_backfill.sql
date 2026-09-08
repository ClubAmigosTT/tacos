-- Repair databases that applied 008 before the import-safe backfill existed.
ALTER TABLE branches ADD COLUMN IF NOT EXISTS taqueria_id text;

UPDATE branches SET taqueria_id = id WHERE taqueria_id IS NULL;

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'branches_taqueria_fk'
  ) THEN
    ALTER TABLE branches ADD CONSTRAINT branches_taqueria_fk FOREIGN KEY (taqueria_id) REFERENCES taquerias(id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE branches ALTER COLUMN taqueria_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS branches_taqueria_idx ON branches(taqueria_id);
