import assert from 'assert';
import { LocalInviteRegistry, decodeInviteCode } from '../utils/inviteCodes';

const registry = new LocalInviteRegistry();

// User A creates a trip and generates an invite code
const tripId = 'trip-123';
const tripName = 'Ski Trip';
const code = registry.create(tripId, tripName);

assert.ok(code && typeof code === 'string', 'Invite code should be a non-empty string');

// User B follows the trip using the invite code
const followed = registry.follow(code);
assert.ok(followed, 'Followed trip should be returned');
assert.strictEqual(followed?.tripId, tripId, 'Trip ID should match');
assert.strictEqual(followed?.tripName, tripName, 'Trip name should match');

// Invalid code returns null
const missing = registry.follow('invalid-code');
assert.strictEqual(missing, null, 'Invalid code should return null');

console.log('Invite code generation and follow test passed.');
