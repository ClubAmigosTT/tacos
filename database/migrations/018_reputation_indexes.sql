-- Keep reputation aggregates bounded to the rows the scoring query can use.
CREATE INDEX IF NOT EXISTS visits_visible_branch_recency_idx
  ON visits(branch_id, visited_at DESC)
  WHERE visibility = 'visible';

CREATE INDEX IF NOT EXISTS visit_items_rated_menu_visit_idx
  ON visit_items(menu_item_id, visit_id)
  WHERE rating IS NOT NULL;
