CREATE TABLE IF NOT EXISTS trip_activity (
  id UUID PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_trip_activity_type
    CHECK (
      type IN (
        'TRIP_CREATED',
        'FOLLOW_ADDED',
        'FOLLOW_REMOVED',
        'ITINERARY_ITEM_ADDED',
        'ITINERARY_ITEM_UPDATED',
        'ITINERARY_ITEM_DELETED',
        'FLIGHT_ADDED',
        'LODGING_ADDED',
        'TOUR_ADDED',
        'NOTE_ADDED'
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_trip_activity_trip_created
  ON trip_activity(trip_id, created_at DESC, id DESC);
