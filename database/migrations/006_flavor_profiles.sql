ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS flavor_profile jsonb NOT NULL DEFAULT '{"intensity":50,"spicy":50,"traditional":50,"texture":50,"value":50}'::jsonb;

UPDATE branches SET flavor_profile = '{"intensity":86,"spicy":72,"traditional":94,"texture":88,"value":78}'::jsonb WHERE id = 'vilsito';
UPDATE branches SET flavor_profile = '{"intensity":68,"spicy":54,"traditional":61,"texture":92,"value":64}'::jsonb WHERE id = 'oriente';
UPDATE branches SET flavor_profile = '{"intensity":74,"spicy":48,"traditional":89,"texture":70,"value":96}'::jsonb WHERE id = 'los-parados';
