-- Items a template put on a trip whose start date is only a placeholder (the 1st of a chosen month).
-- While a row exists the traveler has not saved that item themselves, so its dates move with the
-- trip when real dates are set; saving the item removes the row and its dates stay where they are.
CREATE TABLE IF NOT EXISTS trip_estimated_items (
  trip_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (trip_id, item_type, item_id)
);
