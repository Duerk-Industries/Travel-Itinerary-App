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
} from '../db';

export const EXPORT_SCHEMA_VERSION = 1;

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
  };
};
