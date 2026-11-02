-- R2: preserve original item currencies and each saved quote's target currency.
CREATE TABLE IF NOT EXISTS trip_money_metadata (
  record_type TEXT NOT NULL,
  record_id UUID NOT NULL,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  amount NUMERIC,
  conversion_currency TEXT,
  converted_amount NUMERIC,
  exchange_rate NUMERIC,
  rate_date DATE,
  expense_date DATE,
  PRIMARY KEY(record_type,record_id)
);
CREATE INDEX IF NOT EXISTS trip_money_metadata_trip ON trip_money_metadata(trip_id);
CREATE TABLE IF NOT EXISTS trip_expense_preferences (
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  PRIMARY KEY(trip_id,user_id)
);
INSERT INTO trip_money_metadata(record_type,record_id,trip_id,currency,amount,conversion_currency,converted_amount,exchange_rate,rate_date,expense_date)
SELECT 'expense',e.id,e.trip_id,COALESCE(e.currency,t.currency,'USD'),e.amount,COALESCE(t.currency,'USD'),e.amount_in_trip_currency,e.exchange_rate_to_trip_currency,e.exchange_rate_date,e.expense_date
FROM expenses e JOIN trips t ON t.id=e.trip_id ON CONFLICT(record_type,record_id) DO NOTHING;
INSERT INTO trip_money_metadata(record_type,record_id,trip_id,currency,amount)
SELECT 'flight',f.id,f.trip_id,COALESCE(t.currency,'USD'),f.cost FROM flights f JOIN trips t ON t.id=f.trip_id ON CONFLICT(record_type,record_id) DO NOTHING;
INSERT INTO trip_money_metadata(record_type,record_id,trip_id,currency,amount)
SELECT 'lodging',l.id,l.trip_id,COALESCE(t.currency,'USD'),l.total_cost FROM lodgings l JOIN trips t ON t.id=l.trip_id ON CONFLICT(record_type,record_id) DO NOTHING;
INSERT INTO trip_money_metadata(record_type,record_id,trip_id,currency,amount)
SELECT 'activity',a.id,a.trip_id,COALESCE(t.currency,'USD'),a.cost FROM tours a JOIN trips t ON t.id=a.trip_id ON CONFLICT(record_type,record_id) DO NOTHING;
INSERT INTO trip_money_metadata(record_type,record_id,trip_id,currency,amount)
SELECT 'car_rental',c.id,c.trip_id,COALESCE(t.currency,'USD'),c.cost FROM car_rentals c JOIN trips t ON t.id=c.trip_id ON CONFLICT(record_type,record_id) DO NOTHING;
