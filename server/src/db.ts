import { getCurrentDbProvider as getProvider, getDbAdapter, resetDbAdapter, type DbProvider } from './db.providers';
import type { Pool } from 'pg';
import type {
  Flight,
  Lodging,
  Activity,
  Trait,
  Trip,
  Itinerary,
  ItineraryDetail,
  User,
  WebUser,
  PlaceDetailsCache,
  PlaceLookupCache,
  Expense,
  LocationRecord,
  AttractionCatalogEntry,
  AttractionShortlistBlob,
  TripActivity,
  TripComment,
  CarRental,
} from './types';

const adapter = () => getDbAdapter();

export { getProvider as getCurrentDbProvider, resetDbAdapter, type DbProvider };

export const closePool = async (): Promise<void> => adapter().closePool();
export const initDb = async (): Promise<void> => adapter().initDb();
export const findOrCreateUser = async (...args: Parameters<ReturnType<typeof adapter>['findOrCreateUser']>) =>
  adapter().findOrCreateUser(...args);
export const findOrCreateGoogleUser = async (...args: Parameters<ReturnType<typeof adapter>['findOrCreateGoogleUser']>) =>
    adapter().findOrCreateGoogleUser(...args);
export const ensureDefaultGroupForUser = async (...args: Parameters<ReturnType<typeof adapter>['ensureDefaultGroupForUser']>) =>
  adapter().ensureDefaultGroupForUser(...args);
export const findUserByEmail = async (email: string): Promise<User | null> => adapter().findUserByEmail(email);
export const findUserByIdentifier = async (identifier: string): Promise<User | null> => adapter().findUserByIdentifier(identifier);
export const getUserById = async (...args: Parameters<ReturnType<typeof adapter>['getUserById']>) =>
  adapter().getUserById(...args);
export const createWebUser = async (...args: Parameters<ReturnType<typeof adapter>['createWebUser']>) =>
  adapter().createWebUser(...args);
export const ensureWebPasswordAccountForOAuth = async (
  ...args: Parameters<ReturnType<typeof adapter>['ensureWebPasswordAccountForOAuth']>
) => adapter().ensureWebPasswordAccountForOAuth(...args);
export const verifyWebUserCredentials = async (...args: Parameters<ReturnType<typeof adapter>['verifyWebUserCredentials']>) =>
  adapter().verifyWebUserCredentials(...args);
export const recordWebUserLogin = async (...args: Parameters<ReturnType<typeof adapter>['recordWebUserLogin']>) =>
  adapter().recordWebUserLogin(...args);
export const createEmailVerification = async (...args: Parameters<ReturnType<typeof adapter>['createEmailVerification']>) =>
  adapter().createEmailVerification(...args);
export const createUserEmailVerification = async (
  ...args: Parameters<ReturnType<typeof adapter>['createUserEmailVerification']>
) => adapter().createUserEmailVerification(...args);
export const getPendingEmailVerification = async (...args: Parameters<ReturnType<typeof adapter>['getPendingEmailVerification']>) =>
  adapter().getPendingEmailVerification(...args);
export const consumeEmailVerificationToken = async (...args: Parameters<ReturnType<typeof adapter>['consumeEmailVerificationToken']>) =>
  adapter().consumeEmailVerificationToken(...args);
export const consumeUserEmailVerificationToken = async (
  ...args: Parameters<ReturnType<typeof adapter>['consumeUserEmailVerificationToken']>
) => adapter().consumeUserEmailVerificationToken(...args);
export const markEmailVerificationUsed = async (...args: Parameters<ReturnType<typeof adapter>['markEmailVerificationUsed']>) =>
  adapter().markEmailVerificationUsed(...args);
export const markUserEmailVerificationUsed = async (
  ...args: Parameters<ReturnType<typeof adapter>['markUserEmailVerificationUsed']>
) => adapter().markUserEmailVerificationUsed(...args);
export const markUserEmailVerified = async (...args: Parameters<ReturnType<typeof adapter>['markUserEmailVerified']>) =>
  adapter().markUserEmailVerified(...args);
export const markAccountEmailVerified = async (
  ...args: Parameters<ReturnType<typeof adapter>['markAccountEmailVerified']>
) => adapter().markAccountEmailVerified(...args);
export const listUserEmails = async (...args: Parameters<ReturnType<typeof adapter>['listUserEmails']>) =>
  adapter().listUserEmails(...args);
export const addUserEmail = async (...args: Parameters<ReturnType<typeof adapter>['addUserEmail']>) =>
  adapter().addUserEmail(...args);
export const setPrimaryUserEmail = async (...args: Parameters<ReturnType<typeof adapter>['setPrimaryUserEmail']>) =>
  adapter().setPrimaryUserEmail(...args);
export const removeUserEmail = async (...args: Parameters<ReturnType<typeof adapter>['removeUserEmail']>) =>
  adapter().removeUserEmail(...args);
export const deleteUserRecord = async (...args: Parameters<ReturnType<typeof adapter>['deleteUserRecord']>) =>
  adapter().deleteUserRecord(...args);
export const getWebUserProfile = async (...args: Parameters<ReturnType<typeof adapter>['getWebUserProfile']>) =>
  adapter().getWebUserProfile(...args);
export const updateWebUserProfile = async (...args: Parameters<ReturnType<typeof adapter>['updateWebUserProfile']>) =>
  adapter().updateWebUserProfile(...args);
export const updateWebUserPassword = async (...args: Parameters<ReturnType<typeof adapter>['updateWebUserPassword']>) =>
  adapter().updateWebUserPassword(...args);
export const setInitialWebUserPassword = async (...args: Parameters<ReturnType<typeof adapter>['setInitialWebUserPassword']>) =>
  adapter().setInitialWebUserPassword(...args);
export const isPasswordSetupRequired = async (...args: Parameters<ReturnType<typeof adapter>['isPasswordSetupRequired']>) =>
  adapter().isPasswordSetupRequired(...args);
export const deleteWebUserAndCleanup = async (...args: Parameters<ReturnType<typeof adapter>['deleteWebUserAndCleanup']>) =>
  adapter().deleteWebUserAndCleanup(...args);
export const deleteAllUsers = async (...args: Parameters<ReturnType<typeof adapter>['deleteAllUsers']>) =>
  adapter().deleteAllUsers(...args);
export const insertFlight = async (...args: Parameters<ReturnType<typeof adapter>['insertFlight']>) =>
  adapter().insertFlight(...args);
export const deleteFlight = async (...args: Parameters<ReturnType<typeof adapter>['deleteFlight']>) =>
  adapter().deleteFlight(...args);
export const updateFlight = async (...args: Parameters<ReturnType<typeof adapter>['updateFlight']>) =>
  adapter().updateFlight(...args);
export const ensureUserInTrip = async (...args: Parameters<ReturnType<typeof adapter>['ensureUserInTrip']>) =>
  adapter().ensureUserInTrip(...args);
export const ensureUserCanReadTrip = async (...args: Parameters<ReturnType<typeof adapter>['ensureUserCanReadTrip']>) =>
  adapter().ensureUserCanReadTrip(...args);
export const getTripGroupId = async (...args: Parameters<ReturnType<typeof adapter>['getTripGroupId']>) =>
  adapter().getTripGroupId(...args);
export const getTripById = async (...args: Parameters<ReturnType<typeof adapter>['getTripById']>) =>
  adapter().getTripById(...args);
export const updateTripDetails = async (...args: Parameters<ReturnType<typeof adapter>['updateTripDetails']>) =>
  adapter().updateTripDetails(...args);
export const getTripCovering = async (...args: Parameters<ReturnType<typeof adapter>['getTripCovering']>) =>
  adapter().getTripCovering(...args);
export const updateTripCovering = async (...args: Parameters<ReturnType<typeof adapter>['updateTripCovering']>) =>
  adapter().updateTripCovering(...args);
export const getFlightForUser = async (...args: Parameters<ReturnType<typeof adapter>['getFlightForUser']>) =>
  adapter().getFlightForUser(...args);
export const listFlights = async (...args: Parameters<ReturnType<typeof adapter>['listFlights']>): Promise<Flight[]> =>
  adapter().listFlights(...args);
export const listLodgings = async (...args: Parameters<ReturnType<typeof adapter>['listLodgings']>): Promise<Lodging[]> =>
  adapter().listLodgings(...args);
export const insertLodging = async (...args: Parameters<ReturnType<typeof adapter>['insertLodging']>) =>
  adapter().insertLodging(...args);
export const deleteLodging = async (...args: Parameters<ReturnType<typeof adapter>['deleteLodging']>) =>
  adapter().deleteLodging(...args);
export const updateLodging = async (...args: Parameters<ReturnType<typeof adapter>['updateLodging']>) =>
  adapter().updateLodging(...args);
export const listActivities = async (...args: Parameters<ReturnType<typeof adapter>['listActivities']>): Promise<Activity[]> =>
  adapter().listActivities(...args);
export const listCarRentals = async (...args: Parameters<ReturnType<typeof adapter>['listCarRentals']>): Promise<CarRental[]> =>
  adapter().listCarRentals(...args);
export const insertActivity = async (...args: Parameters<ReturnType<typeof adapter>['insertActivity']>) =>
  adapter().insertActivity(...args);
export const insertCarRental = async (...args: Parameters<ReturnType<typeof adapter>['insertCarRental']>) =>
  adapter().insertCarRental(...args);
export const updateActivity = async (...args: Parameters<ReturnType<typeof adapter>['updateActivity']>) =>
  adapter().updateActivity(...args);
export const updateCarRental = async (...args: Parameters<ReturnType<typeof adapter>['updateCarRental']>) =>
  adapter().updateCarRental(...args);
export const deleteActivity = async (...args: Parameters<ReturnType<typeof adapter>['deleteActivity']>) =>
  adapter().deleteActivity(...args);
export const deleteCarRental = async (...args: Parameters<ReturnType<typeof adapter>['deleteCarRental']>) =>
  adapter().deleteCarRental(...args);
export const getCarRentalById = async (...args: Parameters<ReturnType<typeof adapter>['getCarRentalById']>) =>
  adapter().getCarRentalById(...args);
export const getFlightById = async (...args: Parameters<ReturnType<typeof adapter>['getFlightById']>) =>
  adapter().getFlightById(...args);
export const getLodgingById = async (...args: Parameters<ReturnType<typeof adapter>['getLodgingById']>) =>
  adapter().getLodgingById(...args);
export const getActivityById = async (...args: Parameters<ReturnType<typeof adapter>['getActivityById']>) =>
  adapter().getActivityById(...args);
export const castItemVote = async (...args: Parameters<ReturnType<typeof adapter>['castItemVote']>) =>
  adapter().castItemVote(...args);
export const getItemVoteSummaries = async (...args: Parameters<ReturnType<typeof adapter>['getItemVoteSummaries']>) =>
  adapter().getItemVoteSummaries(...args);
export const shareFlight = async (...args: Parameters<ReturnType<typeof adapter>['shareFlight']>) =>
  adapter().shareFlight(...args);
export const listGroupMembers = async (...args: Parameters<ReturnType<typeof adapter>['listGroupMembers']>) =>
  adapter().listGroupMembers(...args);
export const listGroupsForUser = async (...args: Parameters<ReturnType<typeof adapter>['listGroupsForUser']>) =>
  adapter().listGroupsForUser(...args);
export const addGroupMember = async (...args: Parameters<ReturnType<typeof adapter>['addGroupMember']>) =>
  adapter().addGroupMember(...args);
export const removeGroupMember = async (...args: Parameters<ReturnType<typeof adapter>['removeGroupMember']>) =>
  adapter().removeGroupMember(...args);
export const removeGroupInvite = async (...args: Parameters<ReturnType<typeof adapter>['removeGroupInvite']>) =>
  adapter().removeGroupInvite(...args);
export const attachInviteToTrip = async (...args: Parameters<ReturnType<typeof adapter>['attachInviteToTrip']>) =>
  adapter().attachInviteToTrip(...args);
export const deleteGroup = async (...args: Parameters<ReturnType<typeof adapter>['deleteGroup']>) =>
  adapter().deleteGroup(...args);
export const listTrips = async (...args: Parameters<ReturnType<typeof adapter>['listTrips']>): Promise<Array<Trip & { groupName: string }>> =>
  adapter().listTrips(...args);
export const createTrip = async (...args: Parameters<ReturnType<typeof adapter>['createTrip']>) =>
  adapter().createTrip(...args);
export const deleteTrip = async (...args: Parameters<ReturnType<typeof adapter>['deleteTrip']>) =>
  adapter().deleteTrip(...args);
export const updateTripGroup = async (...args: Parameters<ReturnType<typeof adapter>['updateTripGroup']>) =>
  adapter().updateTripGroup(...args);
export const getTripFollowCode = async (...args: Parameters<ReturnType<typeof adapter>['getTripFollowCode']>) =>
  adapter().getTripFollowCode(...args);
export const followTripByCode = async (...args: Parameters<ReturnType<typeof adapter>['followTripByCode']>) =>
  adapter().followTripByCode(...args);
export const listFollowedTrips = async (...args: Parameters<ReturnType<typeof adapter>['listFollowedTrips']>) =>
  adapter().listFollowedTrips(...args);
export const unfollowTrip = async (...args: Parameters<ReturnType<typeof adapter>['unfollowTrip']>) =>
  adapter().unfollowTrip(...args);
export const listTripShareInvites = async (...args: Parameters<ReturnType<typeof adapter>['listTripShareInvites']>) =>
  adapter().listTripShareInvites(...args);
export const createTripShareInvite = async (...args: Parameters<ReturnType<typeof adapter>['createTripShareInvite']>) =>
  adapter().createTripShareInvite(...args);
export const listPendingTripShareInvitesForUser = async (
  ...args: Parameters<ReturnType<typeof adapter>['listPendingTripShareInvitesForUser']>
) => adapter().listPendingTripShareInvitesForUser(...args);
export const acceptTripShareInvite = async (...args: Parameters<ReturnType<typeof adapter>['acceptTripShareInvite']>) =>
  adapter().acceptTripShareInvite(...args);
export const acceptTripShareInviteById = async (...args: Parameters<ReturnType<typeof adapter>['acceptTripShareInviteById']>) =>
  adapter().acceptTripShareInviteById(...args);
export const rejectTripShareInvite = async (...args: Parameters<ReturnType<typeof adapter>['rejectTripShareInvite']>) =>
  adapter().rejectTripShareInvite(...args);
export const revokeTripShareInvite = async (...args: Parameters<ReturnType<typeof adapter>['revokeTripShareInvite']>) =>
  adapter().revokeTripShareInvite(...args);
export const writeActivity = async (...args: Parameters<ReturnType<typeof adapter>['writeActivity']>) =>
  adapter().writeActivity(...args);
export const listTripActivity = async (...args: Parameters<ReturnType<typeof adapter>['listTripActivity']>) =>
  adapter().listTripActivity(...args) as Promise<{ events: TripActivity[]; nextCursor: string | null }>;
export const listTripComments = async (...args: Parameters<ReturnType<typeof adapter>['listTripComments']>) =>
  adapter().listTripComments(...args) as Promise<TripComment[]>;
export const addTripComment = async (...args: Parameters<ReturnType<typeof adapter>['addTripComment']>) =>
  adapter().addTripComment(...args) as Promise<TripComment>;
export const createGroupWithMembers = async (...args: Parameters<ReturnType<typeof adapter>['createGroupWithMembers']>) =>
  adapter().createGroupWithMembers(...args);
export const createTripWithGroupAndMembers = async (
  ...args: Parameters<ReturnType<typeof adapter>['createTripWithGroupAndMembers']>
) => adapter().createTripWithGroupAndMembers(...args);
export const listGroupInvitesForUser = async (...args: Parameters<ReturnType<typeof adapter>['listGroupInvitesForUser']>) =>
  adapter().listGroupInvitesForUser(...args);
export const acceptGroupInvite = async (...args: Parameters<ReturnType<typeof adapter>['acceptGroupInvite']>) =>
  adapter().acceptGroupInvite(...args);
export const rejectGroupInvite = async (...args: Parameters<ReturnType<typeof adapter>['rejectGroupInvite']>) =>
  adapter().rejectGroupInvite(...args);
export const claimInvitesForUser = async (...args: Parameters<ReturnType<typeof adapter>['claimInvitesForUser']>) =>
  adapter().claimInvitesForUser(...args);
export const getAirportByIataCode = async (...args: Parameters<ReturnType<typeof adapter>['getAirportByIataCode']>) =>
  adapter().getAirportByIataCode(...args);
export const searchFlightLocations = async (...args: Parameters<ReturnType<typeof adapter>['searchFlightLocations']>) =>
  adapter().searchFlightLocations(...args);
export const searchLocations = async (...args: Parameters<ReturnType<typeof adapter>['searchLocations']>): Promise<LocationRecord[]> =>
  adapter().searchLocations(...args);
export const getLocationsByIds = async (...args: Parameters<ReturnType<typeof adapter>['getLocationsByIds']>): Promise<LocationRecord[]> =>
  adapter().getLocationsByIds(...args);
export const upsertLocation = async (...args: Parameters<ReturnType<typeof adapter>['upsertLocation']>) =>
  adapter().upsertLocation(...args);
export const listAttractionCatalogEntries = async (
  ...args: Parameters<ReturnType<typeof adapter>['listAttractionCatalogEntries']>
): Promise<AttractionCatalogEntry[]> => adapter().listAttractionCatalogEntries(...args);
export const upsertAttractionCatalogEntry = async (
  ...args: Parameters<ReturnType<typeof adapter>['upsertAttractionCatalogEntry']>
) => adapter().upsertAttractionCatalogEntry(...args);
export const getAttractionShortlistBlob = async (
  ...args: Parameters<ReturnType<typeof adapter>['getAttractionShortlistBlob']>
): Promise<AttractionShortlistBlob | null> => adapter().getAttractionShortlistBlob(...args);
export const upsertAttractionShortlistBlob = async (
  ...args: Parameters<ReturnType<typeof adapter>['upsertAttractionShortlistBlob']>
) => adapter().upsertAttractionShortlistBlob(...args);
export const listTraits = async (...args: Parameters<ReturnType<typeof adapter>['listTraits']>): Promise<Trait[]> =>
  adapter().listTraits(...args);
export const createTrait = async (...args: Parameters<ReturnType<typeof adapter>['createTrait']>) =>
  adapter().createTrait(...args);
export const updateTrait = async (...args: Parameters<ReturnType<typeof adapter>['updateTrait']>) =>
  adapter().updateTrait(...args);
export const deleteTrait = async (...args: Parameters<ReturnType<typeof adapter>['deleteTrait']>) =>
  adapter().deleteTrait(...args);
export const refreshAirportsDaily = async (): Promise<void> => adapter().refreshAirportsDaily();
export const searchUsersByEmail = async (...args: Parameters<ReturnType<typeof adapter>['searchUsersByEmail']>) =>
  adapter().searchUsersByEmail(...args);
export const listTraitsForGroupTrip = async (...args: Parameters<ReturnType<typeof adapter>['listTraitsForGroupTrip']>) =>
  adapter().listTraitsForGroupTrip(...args);
export const getUserDemographics = async (...args: Parameters<ReturnType<typeof adapter>['getUserDemographics']>) =>
  adapter().getUserDemographics(...args);

export const listExpenses = async (...args: Parameters<ReturnType<typeof adapter>['listExpenses']>): Promise<Expense[]> =>
  adapter().listExpenses(...args);
export const insertExpense = async (...args: Parameters<ReturnType<typeof adapter>['insertExpense']>) =>
  adapter().insertExpense(...args);
export const upsertExpenseForSource = async (...args: Parameters<ReturnType<typeof adapter>['upsertExpenseForSource']>) =>
  adapter().upsertExpenseForSource(...args);
export const deleteExpense = async (...args: Parameters<ReturnType<typeof adapter>['deleteExpense']>) =>
  adapter().deleteExpense(...args);
export const deleteExpenseForSource = async (...args: Parameters<ReturnType<typeof adapter>['deleteExpenseForSource']>) =>
  adapter().deleteExpenseForSource(...args);
export const listTripPayments = async (...args: Parameters<ReturnType<typeof adapter>['listTripPayments']>) =>
  adapter().listTripPayments(...args);
export const insertTripPayment = async (...args: Parameters<ReturnType<typeof adapter>['insertTripPayment']>) =>
  adapter().insertTripPayment(...args);
export const deleteTripPayment = async (...args: Parameters<ReturnType<typeof adapter>['deleteTripPayment']>) =>
  adapter().deleteTripPayment(...args);
export const saveUserDemographics = async (...args: Parameters<ReturnType<typeof adapter>['saveUserDemographics']>) =>
  adapter().saveUserDemographics(...args);
export const listItineraries = async (
  ...args: Parameters<ReturnType<typeof adapter>['listItineraries']>
): Promise<Array<Itinerary & { tripName: string }>> => adapter().listItineraries(...args);
export const createItineraryRecord = async (...args: Parameters<ReturnType<typeof adapter>['createItineraryRecord']>) =>
  adapter().createItineraryRecord(...args);
export const deleteItineraryRecord = async (...args: Parameters<ReturnType<typeof adapter>['deleteItineraryRecord']>) =>
  adapter().deleteItineraryRecord(...args);
export const updateItineraryRecord = async (...args: Parameters<ReturnType<typeof adapter>['updateItineraryRecord']>) =>
  adapter().updateItineraryRecord(...args);
export const listItineraryDetails = async (...args: Parameters<ReturnType<typeof adapter>['listItineraryDetails']>) =>
  adapter().listItineraryDetails(...args);
export const addItineraryDetail = async (...args: Parameters<ReturnType<typeof adapter>['addItineraryDetail']>) =>
  adapter().addItineraryDetail(...args);
export const deleteItineraryDetail = async (...args: Parameters<ReturnType<typeof adapter>['deleteItineraryDetail']>) =>
  adapter().deleteItineraryDetail(...args);
export const updateItineraryDetail = async (...args: Parameters<ReturnType<typeof adapter>['updateItineraryDetail']>) =>
  adapter().updateItineraryDetail(...args);
export const getPlaceDetailsCache = async (
  placeId: string
): Promise<PlaceDetailsCache | null> => adapter().getPlaceDetailsCache(placeId);
export const upsertPlaceDetailsCache = async (
  entry: Parameters<ReturnType<typeof adapter>['upsertPlaceDetailsCache']>[0]
): Promise<void> => adapter().upsertPlaceDetailsCache(entry);
export const getPlaceLookupCache = async (
  queryKey: string
): Promise<PlaceLookupCache | null> => adapter().getPlaceLookupCache(queryKey);
export const upsertPlaceLookupCache = async (
  entry: Parameters<ReturnType<typeof adapter>['upsertPlaceLookupCache']>[0]
): Promise<void> => adapter().upsertPlaceLookupCache(entry);
export const listFamilyRelationships = async (...args: Parameters<ReturnType<typeof adapter>['listFamilyRelationships']>) =>
  adapter().listFamilyRelationships(...args);
export const listFellowTravelers = async (...args: Parameters<ReturnType<typeof adapter>['listFellowTravelers']>) =>
  adapter().listFellowTravelers(...args);
export const createFellowTraveler = async (...args: Parameters<ReturnType<typeof adapter>['createFellowTraveler']>) =>
  adapter().createFellowTraveler(...args);
export const updateFellowTraveler = async (...args: Parameters<ReturnType<typeof adapter>['updateFellowTraveler']>) =>
  adapter().updateFellowTraveler(...args);
export const removeFellowTraveler = async (...args: Parameters<ReturnType<typeof adapter>['removeFellowTraveler']>) =>
  adapter().removeFellowTraveler(...args);
export const searchTripContacts = async (...args: Parameters<ReturnType<typeof adapter>['searchTripContacts']>) =>
  adapter().searchTripContacts(...args);
export const createFamilyRelationship = async (
  ...args: Parameters<ReturnType<typeof adapter>['createFamilyRelationship']>
) => adapter().createFamilyRelationship(...args);
export const acceptFamilyRelationship = async (...args: Parameters<ReturnType<typeof adapter>['acceptFamilyRelationship']>) =>
  adapter().acceptFamilyRelationship(...args);
export const rejectFamilyRelationship = async (...args: Parameters<ReturnType<typeof adapter>['rejectFamilyRelationship']>) =>
  adapter().rejectFamilyRelationship(...args);
export const removeFamilyRelationship = async (...args: Parameters<ReturnType<typeof adapter>['removeFamilyRelationship']>) =>
  adapter().removeFamilyRelationship(...args);
export const updateFamilyProfile = async (...args: Parameters<ReturnType<typeof adapter>['updateFamilyProfile']>) =>
  adapter().updateFamilyProfile(...args);
export const poolClient = (): Pool => adapter().poolClient();
export const getPool = (): Pool => adapter().poolClient();

// ---- Entitlement system facade exports ----
export const getUserRole = async (...args: Parameters<ReturnType<typeof adapter>['getUserRole']>) =>
  adapter().getUserRole(...args);
export const setUserRole = async (...args: Parameters<ReturnType<typeof adapter>['setUserRole']>) =>
  adapter().setUserRole(...args);
export const listTiers = async (...args: Parameters<ReturnType<typeof adapter>['listTiers']>) =>
  adapter().listTiers(...args);
export const getTierByKey = async (...args: Parameters<ReturnType<typeof adapter>['getTierByKey']>) =>
  adapter().getTierByKey(...args);
export const listFeatures = async (...args: Parameters<ReturnType<typeof adapter>['listFeatures']>) =>
  adapter().listFeatures(...args);
export const listTierLimits = async (...args: Parameters<ReturnType<typeof adapter>['listTierLimits']>) =>
  adapter().listTierLimits(...args);
export const upsertTierLimit = async (...args: Parameters<ReturnType<typeof adapter>['upsertTierLimit']>) =>
  adapter().upsertTierLimit(...args);
export const getTierLimitValue = async (...args: Parameters<ReturnType<typeof adapter>['getTierLimitValue']>) =>
  adapter().getTierLimitValue(...args);
export const listTierEntitlements = async (...args: Parameters<ReturnType<typeof adapter>['listTierEntitlements']>) =>
  adapter().listTierEntitlements(...args);
export const upsertTierEntitlement = async (...args: Parameters<ReturnType<typeof adapter>['upsertTierEntitlement']>) =>
  adapter().upsertTierEntitlement(...args);
export const getCurrentUserTier = async (...args: Parameters<ReturnType<typeof adapter>['getCurrentUserTier']>) =>
  adapter().getCurrentUserTier(...args);
export const setUserTier = async (...args: Parameters<ReturnType<typeof adapter>['setUserTier']>) =>
  adapter().setUserTier(...args);
export const ensureCurrentUserTier = async (...args: Parameters<ReturnType<typeof adapter>['ensureCurrentUserTier']>) =>
  adapter().ensureCurrentUserTier(...args);
export const upsertTier = async (...args: Parameters<ReturnType<typeof adapter>['upsertTier']>) =>
  adapter().upsertTier(...args);
export const upsertFeature = async (...args: Parameters<ReturnType<typeof adapter>['upsertFeature']>) =>
  adapter().upsertFeature(...args);
export const getFeatureFlag = async (...args: Parameters<ReturnType<typeof adapter>['getFeatureFlag']>) =>
  adapter().getFeatureFlag(...args);
export const listFeatureFlags = async (...args: Parameters<ReturnType<typeof adapter>['listFeatureFlags']>) =>
  adapter().listFeatureFlags(...args);
export const setFeatureFlag = async (...args: Parameters<ReturnType<typeof adapter>['setFeatureFlag']>) =>
  adapter().setFeatureFlag(...args);
export const getUsageCounter = async (...args: Parameters<ReturnType<typeof adapter>['getUsageCounter']>) =>
  adapter().getUsageCounter(...args);
export const setUsageCounter = async (...args: Parameters<ReturnType<typeof adapter>['setUsageCounter']>) =>
  adapter().setUsageCounter(...args);
export const incrementUsageCounter = async (...args: Parameters<ReturnType<typeof adapter>['incrementUsageCounter']>) =>
  adapter().incrementUsageCounter(...args);
export const appendUsageEvent = async (...args: Parameters<ReturnType<typeof adapter>['appendUsageEvent']>) =>
  adapter().appendUsageEvent(...args);
export const getApiCostCounter = async (...args: Parameters<ReturnType<typeof adapter>['getApiCostCounter']>) =>
  adapter().getApiCostCounter(...args);
export const incrementApiCostCounter = async (...args: Parameters<ReturnType<typeof adapter>['incrementApiCostCounter']>) =>
  adapter().incrementApiCostCounter(...args);
export const getApiUsageCount = async (...args: Parameters<ReturnType<typeof adapter>['getApiUsageCount']>) =>
  adapter().getApiUsageCount(...args);
export const atomicIncrementApiUsageIfUnderLimit = async (
  ...args: Parameters<ReturnType<typeof adapter>['atomicIncrementApiUsageIfUnderLimit']>
) => adapter().atomicIncrementApiUsageIfUnderLimit(...args);
export const listApiUsageCounters = async (...args: Parameters<ReturnType<typeof adapter>['listApiUsageCounters']>) =>
  adapter().listApiUsageCounters(...args);
export const resetApiUsageCounters = async (...args: Parameters<ReturnType<typeof adapter>['resetApiUsageCounters']>) =>
  adapter().resetApiUsageCounters(...args);
export const listApiCostCounters = async (...args: Parameters<ReturnType<typeof adapter>['listApiCostCounters']>) =>
  adapter().listApiCostCounters(...args);
export const resetApiCostCounters = async (...args: Parameters<ReturnType<typeof adapter>['resetApiCostCounters']>) =>
  adapter().resetApiCostCounters(...args);
export const atomicIncrementIfUnderLimit = async (...args: Parameters<ReturnType<typeof adapter>['atomicIncrementIfUnderLimit']>) =>
  adapter().atomicIncrementIfUnderLimit(...args);
export const getGenerationIdempotency = async (
  ...args: Parameters<ReturnType<typeof adapter>['getGenerationIdempotency']>
) => adapter().getGenerationIdempotency(...args);
export const reserveGenerationIdempotency = async (
  ...args: Parameters<ReturnType<typeof adapter>['reserveGenerationIdempotency']>
) => adapter().reserveGenerationIdempotency(...args);
export const completeGenerationIdempotency = async (
  ...args: Parameters<ReturnType<typeof adapter>['completeGenerationIdempotency']>
) => adapter().completeGenerationIdempotency(...args);
export const failGenerationIdempotency = async (
  ...args: Parameters<ReturnType<typeof adapter>['failGenerationIdempotency']>
) => adapter().failGenerationIdempotency(...args);
export const countReservedOrCompletedUsage = async (
  ...args: Parameters<ReturnType<typeof adapter>['countReservedOrCompletedUsage']>
) => adapter().countReservedOrCompletedUsage(...args);
export const writeAuditLog = async (...args: Parameters<ReturnType<typeof adapter>['writeAuditLog']>) =>
  adapter().writeAuditLog(...args);
export const listAuditLog = async (...args: Parameters<ReturnType<typeof adapter>['listAuditLog']>) =>
  adapter().listAuditLog(...args);
export const deleteAuditLog = async (...args: Parameters<ReturnType<typeof adapter>['deleteAuditLog']>) =>
  adapter().deleteAuditLog(...args);
export const setPasswordSetupRequired = async (...args: Parameters<ReturnType<typeof adapter>['setPasswordSetupRequired']>) =>
  adapter().setPasswordSetupRequired(...args);
export const countActiveTripsForUser = async (...args: Parameters<ReturnType<typeof adapter>['countActiveTripsForUser']>) =>
  adapter().countActiveTripsForUser(...args);
export const countGroupMembers = async (...args: Parameters<ReturnType<typeof adapter>['countGroupMembers']>) =>
  adapter().countGroupMembers(...args);
export const adminSearchUsers = async (...args: Parameters<ReturnType<typeof adapter>['adminSearchUsers']>) =>
  adapter().adminSearchUsers(...args);
export const adminGetUser = async (...args: Parameters<ReturnType<typeof adapter>['adminGetUser']>) =>
  adapter().adminGetUser(...args);
export const adminGetUserData = async (...args: Parameters<ReturnType<typeof adapter>['adminGetUserData']>) =>
  adapter().adminGetUserData(...args);

export const listTripMessages = async (...args: Parameters<ReturnType<typeof adapter>['listTripMessages']>) =>
  adapter().listTripMessages(...args);
export const listTripMessagesPage = async (...args: Parameters<ReturnType<typeof adapter>['listTripMessagesPage']>) =>
  adapter().listTripMessagesPage(...args);
export const addTripMessage = async (...args: Parameters<ReturnType<typeof adapter>['addTripMessage']>) =>
  adapter().addTripMessage(...args);
export const markMessagesRead = async (...args: Parameters<ReturnType<typeof adapter>['markMessagesRead']>) =>
  adapter().markMessagesRead(...args);
export const countUnreadMessages = async (...args: Parameters<ReturnType<typeof adapter>['countUnreadMessages']>) =>
  adapter().countUnreadMessages(...args);
