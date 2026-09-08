CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE IF NOT EXISTS branches (
  id text PRIMARY KEY,
  name text NOT NULL,
  neighborhood text NOT NULL,
  address text,
  location geography(Point, 4326) NOT NULL,
  open_until text NOT NULL DEFAULT '23:00',
  style text NOT NULL DEFAULT 'Clásico callejero',
  image_url text NOT NULL,
  description text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  search_text text NOT NULL DEFAULT '',
  rating numeric(4,2) NOT NULL DEFAULT 0,
  match_score numeric(5,2) NOT NULL DEFAULT 80,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS branches_location_gist ON branches USING GIST (location);
CREATE INDEX IF NOT EXISTS branches_search_trgm ON branches USING GIN (search_text gin_trgm_ops);

CREATE TABLE IF NOT EXISTS menu_items (
  id text PRIMARY KEY,
  branch_id text NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  note text NOT NULL DEFAULT '',
  price numeric(8,2) NOT NULL DEFAULT 0,
  rating numeric(4,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS menu_items_branch_idx ON menu_items(branch_id);

CREATE TABLE IF NOT EXISTS visits (
  id uuid PRIMARY KEY,
  user_id text,
  branch_id text NOT NULL REFERENCES branches(id),
  rating numeric(2,1) NOT NULL CHECK (rating BETWEEN 1 AND 5),
  visited_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visit_items (
  visit_id uuid NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  menu_item_id text NOT NULL REFERENCES menu_items(id),
  PRIMARY KEY (visit_id, menu_item_id)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO branches (id, name, neighborhood, address, location, open_until, style, image_url, description, tags, search_text, rating, match_score)
VALUES
  ('vilsito', 'El Vilsito', 'Narvarte', 'Av. Universidad 1093', ST_SetSRID(ST_MakePoint(-99.1571, 19.3869), 4326)::geography, '03:00', 'Pastor nocturno', 'https://images.unsplash.com/photo-1552332386-f8dd00dc2f85?auto=format&fit=crop&w=1200&q=80', 'Pastor intenso, tortilla recién hecha y una noche que casi nunca termina.', ARRAY['clásico','madrugada','salsa fuerte'], 'El Vilsito Narvarte Pastor nocturno clásico madrugada salsa fuerte', 4.87, 96),
  ('oriente', 'Tacos Oriente', 'Roma Sur', 'Colima 180', ST_SetSRID(ST_MakePoint(-99.1622, 19.4055), 4326)::geography, '01:30', 'Suadero elegante', 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?auto=format&fit=crop&w=1200&q=80', 'Una taquería compacta y precisa, con gran control de grasa, textura y salsa.', ARRAY['suave','salsa verde','precio medio'], 'Tacos Oriente Roma Sur Suadero elegante suave salsa verde precio medio', 4.76, 91),
  ('los-parados', 'Los Parados', 'Condesa', 'Nuevo León 107', ST_SetSRID(ST_MakePoint(-99.1712, 19.4143), 4326)::geography, '00:30', 'Clásico callejero', 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?auto=format&fit=crop&w=1200&q=80', 'Tacos directos, rápidos y sin pretensiones para una noche de antojo.', ARRAY['barato','rápido','clásico'], 'Los Parados Condesa Clásico callejero barato rápido clásico', 4.61, 84)
ON CONFLICT (id) DO NOTHING;

INSERT INTO menu_items (id, branch_id, name, note, price, rating)
VALUES
  ('vilsito-pastor','vilsito','Pastor','Piña, borde crujiente y adobo profundo.',22,4.92),
  ('vilsito-suadero','vilsito','Suadero','Graso en el buen sentido; pide doble tortilla.',24,4.58),
  ('oriente-suadero','oriente','Suadero','Textura mantequillosa y final limpio.',28,4.88),
  ('oriente-campechano','oriente','Campechano','Más intenso, con buen contraste de texturas.',32,4.72),
  ('parados-carnitas','los-parados','Carnitas','Pide surtida para probar las partes.',20,4.69),
  ('parados-pastor','los-parados','Pastor','Más dulce y ligero que el promedio.',18,4.55)
ON CONFLICT (id) DO NOTHING;
