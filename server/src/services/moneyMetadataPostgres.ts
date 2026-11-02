import { queryBlog, withBlogTransaction } from '../db.postgres';
import type { TripMoneyMetadata } from '../types';

export const getTripMoneyMetadata = async (kind: TripMoneyMetadata['recordType'], ids: string[]): Promise<TripMoneyMetadata[]> => {
  if (!ids.length) return [];
  const slots = ids.map((_, index) => `$${index + 2}`).join(',');
  const result = await queryBlog<TripMoneyMetadata>(`SELECT record_type AS "recordType",record_id AS "recordId",trip_id AS "tripId",currency,
    amount,conversion_currency AS "conversionCurrency",converted_amount AS "amountInTripCurrency",exchange_rate AS "exchangeRateToTripCurrency",
    to_char(expense_date,'YYYY-MM-DD') AS "expenseDate", to_char(rate_date,'YYYY-MM-DD') AS "exchangeRateDate" FROM trip_money_metadata WHERE record_type=$1 AND record_id IN (${slots})`, [kind, ...ids]);
  return result.rows.map(r => ({ ...r, amount: r.amount == null ? null : Number(r.amount), amountInTripCurrency: r.amountInTripCurrency == null ? null : Number(r.amountInTripCurrency), exchangeRateToTripCurrency: r.exchangeRateToTripCurrency == null ? null : Number(r.exchangeRateToTripCurrency) }));
};
export const saveTripMoneyMetadata = async (rows: TripMoneyMetadata[]): Promise<void> => {
  if (!rows.length) return;
  await withBlogTransaction(async client => {
    for (const r of rows) await client.query(`INSERT INTO trip_money_metadata(record_type,record_id,trip_id,currency,amount,conversion_currency,converted_amount,exchange_rate,rate_date,expense_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(record_type,record_id) DO UPDATE SET currency=EXCLUDED.currency,amount=EXCLUDED.amount,
      conversion_currency=EXCLUDED.conversion_currency,converted_amount=EXCLUDED.converted_amount,exchange_rate=EXCLUDED.exchange_rate,rate_date=EXCLUDED.rate_date,expense_date=EXCLUDED.expense_date`,
    [r.recordType,r.recordId,r.tripId,r.currency,r.amount,r.conversionCurrency,r.amountInTripCurrency,r.exchangeRateToTripCurrency,r.exchangeRateDate,r.expenseDate ?? null]);
  });
};
export const getLastExpenseCurrency = async (userId: string, tripId: string): Promise<string | null> => (await queryBlog<{ currency: string }>('SELECT currency FROM trip_expense_preferences WHERE user_id=$1 AND trip_id=$2', [userId, tripId])).rows[0]?.currency ?? null;
export const setLastExpenseCurrency = async (userId: string, tripId: string, currency: string): Promise<void> => { await queryBlog('INSERT INTO trip_expense_preferences(user_id,trip_id,currency) VALUES($1,$2,$3) ON CONFLICT(trip_id,user_id) DO UPDATE SET currency=EXCLUDED.currency', [userId,tripId,currency]); };
