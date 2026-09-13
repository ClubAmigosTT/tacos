-- The main taqueria score and the five quality dimensions use half-star
-- increments. A value of 0 means that the user left that dimension unrated.
ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_rating_check;
ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_rating_half_step_check;
ALTER TABLE visits
  ADD CONSTRAINT visits_rating_half_step_check
  CHECK (rating >= 0 AND rating <= 5 AND rating * 2 = trunc(rating * 2));

ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS tortilla_rating numeric(2,1),
  ADD COLUMN IF NOT EXISTS service_rating numeric(2,1),
  ADD COLUMN IF NOT EXISTS price_rating numeric(2,1),
  ADD COLUMN IF NOT EXISTS meat_rating numeric(2,1),
  ADD COLUMN IF NOT EXISTS salsas_rating numeric(2,1);

ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_tortilla_rating_half_step_check;
ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_service_rating_half_step_check;
ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_price_rating_half_step_check;
ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_meat_rating_half_step_check;
ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_salsas_rating_half_step_check;

ALTER TABLE visits
  ADD CONSTRAINT visits_tortilla_rating_half_step_check
    CHECK (tortilla_rating IS NULL OR (tortilla_rating >= 0 AND tortilla_rating <= 5 AND tortilla_rating * 2 = trunc(tortilla_rating * 2))),
  ADD CONSTRAINT visits_service_rating_half_step_check
    CHECK (service_rating IS NULL OR (service_rating >= 0 AND service_rating <= 5 AND service_rating * 2 = trunc(service_rating * 2))),
  ADD CONSTRAINT visits_price_rating_half_step_check
    CHECK (price_rating IS NULL OR (price_rating >= 0 AND price_rating <= 5 AND price_rating * 2 = trunc(price_rating * 2))),
  ADD CONSTRAINT visits_meat_rating_half_step_check
    CHECK (meat_rating IS NULL OR (meat_rating >= 0 AND meat_rating <= 5 AND meat_rating * 2 = trunc(meat_rating * 2))),
  ADD CONSTRAINT visits_salsas_rating_half_step_check
    CHECK (salsas_rating IS NULL OR (salsas_rating >= 0 AND salsas_rating <= 5 AND salsas_rating * 2 = trunc(salsas_rating * 2)));
