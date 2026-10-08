import type { AnalyticsFeature } from '../../../packages/analytics/src/registry';

/**
 * Maps App.tsx page names to stable analytics feature names. Admin pages are never
 * tracked. `tripScoped` pages attach the active trip (as a server-side pseudonym).
 */
const PAGE_FEATURES: Record<string, { feature: AnalyticsFeature; tripScoped: boolean }> = {
  home: { feature: 'home', tripScoped: false },
  trips: { feature: 'trips', tripScoped: false },
  'create-trip': { feature: 'create_trip', tripScoped: false },
  overview: { feature: 'overview', tripScoped: true },
  flights: { feature: 'transfers', tripScoped: true },
  lodging: { feature: 'lodging', tripScoped: true },
  car: { feature: 'car_rentals', tripScoped: true },
  tours: { feature: 'activities', tripScoped: true },
  expenses: { feature: 'expenses', tripScoped: true },
  ledger: { feature: 'ledger', tripScoped: true },
  packing: { feature: 'packing', tripScoped: true },
  ingest: { feature: 'imports', tripScoped: true },
  blog: { feature: 'blog', tripScoped: true },
  cost: { feature: 'cost_report', tripScoped: true },
  follow: { feature: 'follow', tripScoped: false },
  following: { feature: 'follow', tripScoped: false },
};

const NEVER_TRACKED = new Set(['admin']);

export const analyticsViewForPage = (
  page: string,
  activeTripId: string | null,
): { feature: AnalyticsFeature | null; tripId: string | null } => {
  if (NEVER_TRACKED.has(page)) return { feature: null, tripId: null };
  const mapped = PAGE_FEATURES[page];
  // Remaining pages are the account/settings family (AccountPage values).
  if (!mapped) return { feature: 'account', tripId: null };
  return { feature: mapped.feature, tripId: mapped.tripScoped ? activeTripId : null };
};
