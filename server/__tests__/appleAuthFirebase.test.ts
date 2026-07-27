/// <reference types="jest" />
/// <reference types="node" />

describe('findOrCreateAppleUser (Firebase)', () => {
  beforeEach(async () => {
    process.env.DB_PROVIDER = 'firebase';
    // Ensure emulator host is set for tests
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
        process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    }
    const { resetDbAdapter, initDb } = require('../src/db') as typeof import('../src/db');
    resetDbAdapter();
    await initDb();
  });

  it('creates a new user in Firestore on first Apple sign-in', async () => {
    const { findOrCreateAppleUser, getUserById } = require('../src/db') as typeof import('../src/db');
    const profile = {
      appleId: `apple-firestore-${Date.now()}`,
      email: `apple-fs-${Date.now()}@example.com`,
      emailVerified: true,
      firstName: 'Firebase',
      lastName: 'Apple',
    };

    const user = await findOrCreateAppleUser(profile);
    const stored = await getUserById(user.id);
    expect(stored).toBeTruthy();
    expect(stored?.email).toBe(profile.email);
    expect(stored?.firstName).toBe(profile.firstName);
    expect(stored?.lastName).toBe(profile.lastName);
    expect(stored?.provider).toBe('apple');
    expect(stored?.role).toBe('user');
    expect(stored?.apple_id).toBe(profile.appleId);
  });

  it('links to an existing Firestore user by verified email', async () => {
    const { findOrCreateUser, findOrCreateAppleUser } = require('../src/db') as typeof import('../src/db');
    const email = `shared-fs-${Date.now()}@example.com`;
    const existing = await findOrCreateUser(email, 'email');

    const profile = {
      appleId: `apple-link-${Date.now()}`,
      email,
      emailVerified: true,
      firstName: 'Linked',
      lastName: 'User',
    };

    const linked = await findOrCreateAppleUser(profile);
    expect(linked.id).toBe(existing.id);
    expect(linked.email).toBe(email);
  });

  it('handles subsequent Apple logins without name payload', async () => {
    const { findOrCreateAppleUser } = require('../src/db') as typeof import('../src/db');
    const appleId = `apple-repeat-${Date.now()}`;
    const email = `repeat-fs-${Date.now()}@example.com`;

    // First login with name
    const first = await findOrCreateAppleUser({
      appleId,
      email,
      emailVerified: true,
      firstName: 'Repeat',
      lastName: 'Visitor',
    });

    // Second login without name (typical Apple behavior)
    const second = await findOrCreateAppleUser({
      appleId,
      email,
      emailVerified: true,
    });

    expect(second.id).toBe(first.id);
  });
});
