CREATE TABLE IF NOT EXISTS taquerias (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO taquerias (id, name, slug, description)
VALUES
  ('vilsito', 'El Vilsito', 'el-vilsito', 'Una taquería de culto para pastor y noches largas.'),
  ('oriente', 'Tacos Oriente', 'tacos-oriente', 'Una casa compacta de suadero preciso y salsas limpias.'),
  ('los-parados', 'Los Parados', 'los-parados', 'Clásicos de barrio para comer rápido y volver pronto.')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, description = EXCLUDED.description, updated_at = now();

ALTER TABLE branches ADD COLUMN IF NOT EXISTS taqueria_id text;
UPDATE branches SET taqueria_id = id WHERE taqueria_id IS NULL;

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
