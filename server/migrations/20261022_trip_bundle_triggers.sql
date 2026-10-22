-- postgres-only: pg-mem uses the conservative statement revision adapter.
-- All mutation paths, including ingestion SQL outside db.ts, share these triggers.
CREATE OR REPLACE FUNCTION planning_bump_revision(scope_key TEXT) RETURNS VOID AS $$
BEGIN
  IF scope_key IS NOT NULL THEN
    INSERT INTO planning_revisions(scope,revision) VALUES(scope_key,1)
      ON CONFLICT(scope) DO UPDATE SET revision=planning_revisions.revision+1;
  END IF;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION planning_graph_changed() RETURNS TRIGGER AS $$
DECLARE
  before_row JSONB := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  after_row JSONB := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  row_data JSONB;
  trip_key TEXT;
  group_key TEXT;
  parent_key TEXT;
BEGIN
  FOR row_data IN SELECT value FROM jsonb_array_elements(jsonb_build_array(before_row,after_row)) LOOP
    trip_key := NULL; group_key := NULL;
    IF TG_TABLE_NAME = 'trips' THEN
      trip_key := row_data->>'id';
    ELSIF TG_TABLE_NAME = 'groups' THEN
      group_key := row_data->>'id';
    ELSIF TG_TABLE_NAME IN ('group_members','group_invites') THEN
      group_key := row_data->>'group_id';
    ELSIF TG_TABLE_NAME IN ('users','web_users') THEN
      IF (before_row->>'email',before_row->>'first_name',before_row->>'last_name',before_row->>'preferred_airport') IS DISTINCT FROM
         (after_row->>'email',after_row->>'first_name',after_row->>'last_name',after_row->>'preferred_airport') THEN
        PERFORM planning_bump_revision('global:profiles');
        FOR group_key IN SELECT DISTINCT group_id::text FROM group_members WHERE user_id::text=row_data->>'id' LOOP
          PERFORM planning_bump_revision('group:' || group_key);
        END LOOP;
      END IF;
    ELSIF TG_TABLE_NAME = 'itinerary_details' THEN
      SELECT trip_id::text INTO trip_key FROM itineraries WHERE id::text=row_data->>'itinerary_id';
    ELSIF TG_TABLE_NAME = 'itinerary_checklist_items' THEN
      SELECT i.trip_id::text INTO trip_key FROM itineraries i JOIN itinerary_details d ON d.itinerary_id=i.id WHERE d.id::text=row_data->>'detail_id';
    ELSE
      trip_key := row_data->>'trip_id';
    END IF;
    IF trip_key IS NOT NULL THEN PERFORM planning_bump_revision('trip:' || trip_key); END IF;
    IF group_key IS NOT NULL THEN PERFORM planning_bump_revision('group:' || group_key); END IF;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['trips','flights','lodgings','tours','car_rentals','itineraries','itinerary_details','itinerary_checklist_items','expenses','trip_payments','groups','group_members','group_invites','users','web_users'] LOOP
    IF to_regclass(table_name) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS planning_graph_revision ON %I',table_name);
      EXECUTE format('CREATE TRIGGER planning_graph_revision AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION planning_graph_changed()',table_name);
    END IF;
  END LOOP;
END;
$$;
