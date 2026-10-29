-- One stored receipt image per expense. The image itself lives in object storage (see
-- services/expenseReceiptStorage.ts); this row records where, so the expense mappers and the
-- expense_date / amount columns stay untouched. Deleting the expense (or its trip) removes the row.
CREATE TABLE IF NOT EXISTS expense_receipts (
  expense_id UUID PRIMARY KEY REFERENCES expenses(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_receipts_trip ON expense_receipts(trip_id);
