/**
 * Neutral taxonomy for transactions. Host applications can map these
 * to their own internal categories.
 *
 * Mirrored (not imported) in server/src/routes/plaidIntegrationRoutes.ts —
 * server/Dockerfile's build context is server/ alone and can't reach this
 * sibling workspace package. Keep both in sync if this union changes.
 */
export type NeutralCategory =
  | 'Food & Drink'
  | 'Travel'
  | 'Shopping'
  | 'Entertainment'
  | 'Health'
  | 'Services'
  | 'Transfer'
  | 'Income'
  | 'Other';

/**
 * Maps Plaid's personal_finance_category.primary to a NeutralCategory.
 */
export const mapPlaidToNeutral = (plaidPrimary?: string | null): NeutralCategory => {
  if (!plaidPrimary) return 'Other';

  const lower = plaidPrimary.toLowerCase();

  if (lower.includes('food_and_drink')) return 'Food & Drink';
  if (lower.includes('travel')) return 'Travel';
  if (lower.includes('transportation')) return 'Travel';
  if (lower.includes('entertainment')) return 'Entertainment';
  if (lower.includes('personal_care')) return 'Health';
  if (lower.includes('medical')) return 'Health';
  if (lower.includes('general_services')) return 'Services';
  if (lower.includes('general_merchandise')) return 'Shopping';
  if (lower.includes('transfer_in') || lower.includes('transfer_out')) return 'Transfer';
  if (lower.includes('income')) return 'Income';

  return 'Other';
};
