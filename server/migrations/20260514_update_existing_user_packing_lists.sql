INSERT INTO user_packing_list_items (id, user_id, category, label, position)
SELECT
  uuid_generate_v4(),
  user_id,
  category,
  label,
  100000 + position
FROM (
  SELECT
    u.id AS user_id,
    defaults.category,
    defaults.label,
    defaults.position
  FROM users u, universal_packing_list_items defaults
) missing
ON CONFLICT (user_id, category, label) DO NOTHING;
