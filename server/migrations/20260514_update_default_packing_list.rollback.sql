DELETE FROM universal_packing_list_items;

INSERT INTO universal_packing_list_items (id, category, label, position)
VALUES
  (uuid_generate_v4(), 'Documents', 'Passport or government ID', 0),
  (uuid_generate_v4(), 'Documents', 'Travel confirmations', 1),
  (uuid_generate_v4(), 'Documents', 'Health insurance card', 2),
  (uuid_generate_v4(), 'Clothing', 'Daily outfits', 3),
  (uuid_generate_v4(), 'Clothing', 'Comfortable walking shoes', 4),
  (uuid_generate_v4(), 'Clothing', 'Sleepwear', 5),
  (uuid_generate_v4(), 'Clothing', 'Light jacket or sweater', 6),
  (uuid_generate_v4(), 'Toiletries', 'Toothbrush and toothpaste', 7),
  (uuid_generate_v4(), 'Toiletries', 'Deodorant', 8),
  (uuid_generate_v4(), 'Toiletries', 'Personal medications', 9),
  (uuid_generate_v4(), 'Electronics', 'Phone charger', 10),
  (uuid_generate_v4(), 'Electronics', 'Power adapter', 11),
  (uuid_generate_v4(), 'Travel Day', 'Reusable water bottle', 12),
  (uuid_generate_v4(), 'Travel Day', 'Snacks', 13);
