import { decideTripForItem } from '../src/ingestion/assignment/autoAssign';
import { getIngestedDocumentById } from '../src/ingestion/shared/repository';
import { getMailReceipt } from '../src/ingestion/shared/mailAdmission';
import { matchItemToTrip } from '../src/ingestion/assignment/tripMatcher';
import type { PersistedParsedItem } from '../src/ingestion/contracts';
jest.mock('../src/db', () => ({ listTrips: jest.fn(async () => []), getFeatureFlag: jest.fn(async () => ({ enabled: true })), getUserById: jest.fn(async () => ({ email: 'owner@example.com', emailVerified: true })) }));
jest.mock('../src/ingestion/shared/repository', () => ({ getIngestedDocumentById: jest.fn() }));
jest.mock('../src/ingestion/shared/mailAdmission', () => ({ getMailReceipt: jest.fn() }));
jest.mock('../src/ingestion/shared/verifiedSenders', () => ({ normalizeSenderEmail: (email: string) => email.toLowerCase(), isVerifiedSender: jest.fn(async () => false) }));
jest.mock('../src/ingestion/assignment/tripMatcher', () => ({ dateOnly: (date: string) => date, matchItemToTrip: jest.fn(() => ({ decision: 'none', candidates: [] })) }));
const item = { id: 'item', userId: 'owner', importJobId: 'job', rawDocId: 'document', sourceType: 'FORWARDED_MAILBOX', extractedFields: { senderTrust: 'VERIFIED_FORWARDER', automaticAssignmentAllowed: true } } as unknown as PersistedParsedItem;
const document = { virusScanStatus: 'PASSED', userId: 'owner', importJobId: 'job', sourceType: 'FORWARDED_MAILBOX', metadata: { receiverReceiptId: 'receipt' } };
const receipt = { userId: 'owner', state: 'PENDING', expiresAt: Date.now() + 60_000, authentication: { receiverId: 'edge', policyVersion: 'v1', author: { email: 'owner@example.com', dkim: 'pass', signingDomain: 'example.com' }, forwarder: { email: 'owner@example.com', domain: 'example.com', method: 'authenticated-submission' } } };
beforeEach(() => {
  jest.clearAllMocks();
  process.env.INGESTION_RECEIVER_AUTH_ID = 'edge'; process.env.INGESTION_RECEIVER_AUTH_POLICY_VERSION = 'v1'; process.env.INGESTION_RECEIVER_AUTH_SECRET = 'test-only-long-receiver-authentication-key';
  (getIngestedDocumentById as jest.Mock).mockResolvedValue(document); (getMailReceipt as jest.Mock).mockResolvedValue(receipt);
});
afterEach(() => { delete process.env.INGESTION_RECEIVER_AUTH_ID; delete process.env.INGESTION_RECEIVER_AUTH_POLICY_VERSION; delete process.env.INGESTION_RECEIVER_AUTH_SECRET; });
it('enables the source gate only from server-owned document and authenticated receipt provenance', async () => {
  await decideTripForItem(item, 'owner', true);
  expect(matchItemToTrip).toHaveBeenCalledWith(item, [], expect.objectContaining({ sourceTrusted: true }));
});
it.each([{ virusScanStatus: 'SKIPPED' }, { virusScanStatus: 'FAILED' }, { userId: 'other' }, { importJobId: 'other' }, { sourceType: 'MANUAL_UPLOAD' }, { metadata: { receiverReceiptId: undefined } }])('does not accept mismatched provenance even if extraction claims trust: %j', async patch => {
  (getIngestedDocumentById as jest.Mock).mockResolvedValue({ ...document, ...patch });
  await decideTripForItem(item, 'owner', true);
  expect(matchItemToTrip).toHaveBeenCalledWith(item, [], expect.objectContaining({ sourceTrusted: false }));
});
it.each([{ state: 'HELD' }, { expiresAt: Date.now() - 1 }, { authentication: undefined }])('keeps held, expired or unauthenticated mail suggestion-only: %j', async patch => {
  (getMailReceipt as jest.Mock).mockResolvedValue({ ...receipt, ...patch });
  await decideTripForItem(item, 'owner', true);
  expect(matchItemToTrip).toHaveBeenCalledWith(item, [], expect.objectContaining({ sourceTrusted: false }));
});
