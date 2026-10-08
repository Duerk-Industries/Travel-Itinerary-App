/**
 * Compose a user data export for the "download my data" capability.
 *
 * The shape mirrors the user-deletion cascade on the write side: anything
 * that `DELETE /api/account` removes because it belongs to this user should
 * appear here so the user can see and extract it before deletion.
 *
 * Not included: shared/cooperative data authored by others (e.g. a lodging
 * created by a co-traveler in a shared trip). The export is scoped to
 * rows whose ownership/author column equals the exporting user.
 */
import {
  getWebUserProfile,
  listUserEmails,
  listTraits,
  listFamilyRelationships,
  listFellowTravelers,
  listGroupsForUser,
  listTrips,
  listUserAuthoredItems,
  getBillingCustomerByUserId,
  listActiveBillingSubscriptionsForUser,
  getPrivacyPreferences,
  listPrivacyChoiceEvents,
  getUserAgeVerificationRecord,
  listProviderCostLedgerEntriesForUser,
  listItineraryGenerationMetricsForUser,
  listAnalyticsSubjectsForUser,
  listAnalyticsEventsForSubjects,
} from '../db';
import { listErasureJobsForUser } from './privacyRightsService';

/**
 * v2 (analytics Phase 4) adds `privacy`, `ageVerification`, `costLedger`,
 * `diagnostics` and `analytics`. Later stores (Phase 2 product analytics) add
 * themselves to `analytics` through registerExportSection.
 */
export const EXPORT_SCHEMA_VERSION = 2;

type ExportSection = (userId: string) => Promise<unknown>;
const extraAnalyticsSections = new Map<string, ExportSection>();

/** Adds a named section under `analytics` in every export. */
export const registerExportSection = (name: string, build: ExportSection): void => {
  extraAnalyticsSections.set(name, build);
};

export interface UserDataExport {
  schemaVersion: number;
  exportedAt: string;
  user: {
    id: string;
    profile: Awaited<ReturnType<typeof getWebUserProfile>>;
    emails: Awaited<ReturnType<typeof listUserEmails>>;
  };
  traits: Awaited<ReturnType<typeof listTraits>>;
  familyRelationships: Awaited<ReturnType<typeof listFamilyRelationships>>;
  fellowTravelers: Awaited<ReturnType<typeof listFellowTravelers>>;
  groups: Awaited<ReturnType<typeof listGroupsForUser>>;
  trips: Awaited<ReturnType<typeof listTrips>>;
  authoredItems: Awaited<ReturnType<typeof listUserAuthoredItems>>;
  billing: {
    stripeCustomerId: string | null;
    subscriptions: Array<{
      subscriptionId: string;
      planKey: string;
      status: string;
      currentPeriodEnd: string | null;
      cancelAtPeriodEnd: boolean;
    }>;
  };
  privacy: {
    preferences: {
      productAnalytics: boolean | null;
      optionalDiagnostics: boolean | null;
      productNoticeVersion: string | null;
      diagnosticsNoticeVersion: string | null;
      updatedAt: string | null;
    } | null;
    choiceHistory: Awaited<ReturnType<typeof listPrivacyChoiceEvents>>;
    erasureRequests: Array<{ id: string; scope: string; status: string; requestedAt: string; completedAt: string | null }>;
  };
  ageVerification: Awaited<ReturnType<typeof getUserAgeVerificationRecord>> | null;
  /** Provider usage attributed to this account (operational cost metering). */
  costLedger: Array<{
    occurredAt: string;
    provider: string;
    model: string | null;
    featureKey: string | null;
    tripId: string | null;
    unitType: string;
    promptTokens: number;
    completionTokens: number;
    requestUnits: number;
    outcome: string;
    estimatedCostUsd: number | null;
  }>;
  diagnostics: {
    itineraryGenerations: Awaited<ReturnType<typeof listItineraryGenerationMetricsForUser>>;
  };
  analytics: Record<string, unknown>;
}

export const buildUserDataExport = async (userId: string): Promise<UserDataExport> => {
  const [
    profile,
    emails,
    traits,
    familyRelationships,
    fellowTravelers,
    groups,
    trips,
    authoredItems,
    billingCustomer,
    billingSubscriptions,
  ] = await Promise.all([
    getWebUserProfile(userId),
    listUserEmails(userId).catch(() => []),
    listTraits(userId).catch(() => []),
    listFamilyRelationships(userId).catch(() => []),
    listFellowTravelers(userId).catch(() => []),
    listGroupsForUser(userId).catch(() => []),
    listTrips(userId).catch(() => []),
    listUserAuthoredItems(userId).catch(() => ({
      flights: [],
      lodgings: [],
      tours: [],
      carRentals: [],
      expenses: [],
      tripMessages: [],
    })),
    getBillingCustomerByUserId(userId).catch(() => null),
    listActiveBillingSubscriptionsForUser(userId).catch(() => []),
  ]);

  const [preferences, choiceHistory, erasureJobs, ageVerification, ledger, itineraryGenerations] = await Promise.all([
    getPrivacyPreferences(userId).catch(() => null),
    listPrivacyChoiceEvents(userId).catch(() => []),
    listErasureJobsForUser(userId).catch(() => []),
    getUserAgeVerificationRecord(userId).catch(() => null),
    listProviderCostLedgerEntriesForUser(userId).catch(() => []),
    listItineraryGenerationMetricsForUser(userId).catch(() => []),
  ]);

  const subjects = await listAnalyticsSubjectsForUser(userId).catch(() => [] as string[]);
  const productEvents = await listAnalyticsEventsForSubjects(subjects).catch(() => []);
  const analytics: Record<string, unknown> = {
    // Internal pseudonyms and keyed trip references are join keys, not the user's data; omitted.
    productAnalytics: {
      status: productEvents.length ? 'collected' : 'none',
      events: productEvents.map((e) => ({
        eventName: e.eventName,
        occurredAt: e.occurredAt,
        feature: e.feature,
        platform: e.platform,
        appVersion: e.appVersion,
        tripPhase: e.tripPhase,
        properties: e.properties,
      })),
    },
  };
  for (const [name, build] of extraAnalyticsSections) {
    analytics[name] = await build(userId).catch(() => ({ status: 'unavailable' }));
  }

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    user: { id: userId, profile, emails },
    traits,
    familyRelationships,
    fellowTravelers,
    groups,
    trips,
    authoredItems,
    billing: {
      stripeCustomerId: billingCustomer?.stripeCustomerId ?? null,
      subscriptions: billingSubscriptions.map((s) => ({
        subscriptionId: s.stripeSubscriptionId,
        planKey: s.planKey,
        status: s.status,
        currentPeriodEnd: s.currentPeriodEnd,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      })),
    },
    privacy: {
      // The diagnostics pseudonym is an internal join key, not the user's data to act on; omitted.
      preferences: preferences
        ? {
            productAnalytics: preferences.productAnalytics,
            optionalDiagnostics: preferences.optionalDiagnostics,
            productNoticeVersion: preferences.productNoticeVersion,
            diagnosticsNoticeVersion: preferences.diagnosticsNoticeVersion,
            updatedAt: preferences.updatedAt,
          }
        : null,
      choiceHistory,
      erasureRequests: erasureJobs.map((job) => ({
        id: job.id,
        scope: job.scope,
        status: job.status,
        requestedAt: job.requestedAt,
        completedAt: job.completedAt,
      })),
    },
    ageVerification,
    costLedger: ledger.map((entry) => ({
      occurredAt: entry.occurredAt,
      provider: entry.provider,
      model: entry.model,
      featureKey: entry.featureKey,
      tripId: entry.tripId,
      unitType: entry.unitType,
      promptTokens: entry.promptTokens,
      completionTokens: entry.completionTokens,
      requestUnits: entry.requestUnits,
      outcome: entry.outcome,
      estimatedCostUsd: entry.estimatedCostMicros == null ? null : entry.estimatedCostMicros / 1_000_000,
    })),
    diagnostics: { itineraryGenerations },
    analytics,
  };
};
