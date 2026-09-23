import { randomUUID } from 'node:crypto';
import { initDb, closePool, ensureWebPasswordAccountForOAuth, findOrCreateGoogleUser, findOrCreateAppleUser, findUserByEmail, deleteAllUsers } from '../src/db';
import { registerAndLoginWebUser, seedTiersForTest } from './helpers';

describe('OAuth password setup skip + cross-provider account linking', () => {
  const userIds: string[] = [];

  beforeAll(async () => {
    await initDb();
    await seedTiersForTest();
  });

  afterAll(async () => {
    if (userIds.length) await deleteAllUsers(userIds);
    await closePool();
  });

  // ensureWebPasswordAccountForOAuth is always called after findOrCreate{Google,Apple}User has
  // already created the underlying `users` row (see server/src/app.ts's OAuth callbacks) — its own
  // `web_users` insert has a foreign key on that row, so these tests create a real user first via
  // the same functions production code uses, rather than a bare random id.
  const createBareOAuthUser = async (provider: 'apple' | 'google'): Promise<{ id: string; email: string }> => {
    const email = `${provider}-${randomUUID()}@example.com`;
    const user = provider === 'apple'
      ? await findOrCreateAppleUser({ appleId: `apple-sub-${randomUUID()}`, email, emailVerified: true, firstName: 'New', lastName: 'Traveler' })
      : await findOrCreateGoogleUser({ id: `google-sub-${randomUUID()}`, emails: [{ value: email }], name: { givenName: 'New', familyName: 'Traveler' }, photos: [] });
    userIds.push(user.id);
    return { id: user.id, email };
  };

  it('does not require password setup for a brand-new Apple sign-in', async () => {
    const user = await createBareOAuthUser('apple');
    const result = await ensureWebPasswordAccountForOAuth(user.id, user.email, 'A', 'Traveler', 'apple');
    expect(result.requiresPasswordSetup).toBe(false);
  });

  it('does not require password setup for a brand-new Google sign-in', async () => {
    const user = await createBareOAuthUser('google');
    const result = await ensureWebPasswordAccountForOAuth(user.id, user.email, 'G', 'Traveler', 'google');
    expect(result.requiresPasswordSetup).toBe(false);
  });

  it('still requires password setup for a non-OAuth (or unrecognized-provider) sign-in', async () => {
    const user = await createBareOAuthUser('google');
    const result = await ensureWebPasswordAccountForOAuth(user.id, user.email, 'O', 'Traveler', 'something-else');
    expect(result.requiresPasswordSetup).toBe(true);
  });

  it('never re-asks a returning Google user for a password even if an old row was flagged before this change', async () => {
    const user = await createBareOAuthUser('google');
    // Simulate a pre-existing account created before Google was exempted (password_setup_required
    // still true in the stored row).
    const first = await ensureWebPasswordAccountForOAuth(user.id, user.email, 'G', 'Legacy', 'not-yet-google-aware');
    expect(first.requiresPasswordSetup).toBe(true);
    const second = await ensureWebPasswordAccountForOAuth(user.id, user.email, 'G', 'Legacy', 'google');
    expect(second.requiresPasswordSetup).toBe(false);
  });

  it('links a Google sign-in to an existing password account with the same email instead of duplicating it', async () => {
    const email = `link-google-${randomUUID()}@example.com`;
    const { userId } = await registerAndLoginWebUser({ email, firstName: 'Link', lastName: 'Traveler', password: 'Password123!' });
    userIds.push(userId);

    const linked = await findOrCreateGoogleUser({
      id: `google-sub-${randomUUID()}`,
      emails: [{ value: email }],
      name: { givenName: 'Link', familyName: 'Traveler' },
      photos: [],
    });
    expect(linked.id).toBe(userId);

    const byEmail = await findUserByEmail(email);
    expect(byEmail?.id).toBe(userId);
  });

  it('links an Apple sign-in to an existing password account with the same email instead of duplicating it', async () => {
    const email = `link-apple-${randomUUID()}@example.com`;
    const { userId } = await registerAndLoginWebUser({ email, firstName: 'Link', lastName: 'Traveler', password: 'Password123!' });
    userIds.push(userId);

    const linked = await findOrCreateAppleUser({
      appleId: `apple-sub-${randomUUID()}`,
      email,
      emailVerified: true,
      firstName: 'Link',
      lastName: 'Traveler',
    });
    expect(linked.id).toBe(userId);
  });

  it('links a Google sign-in to an existing Apple-created account with the same email', async () => {
    const email = `link-apple-then-google-${randomUUID()}@example.com`;
    const appleUser = await findOrCreateAppleUser({
      appleId: `apple-sub-${randomUUID()}`,
      email,
      emailVerified: true,
      firstName: 'Cross',
      lastName: 'Provider',
    });
    userIds.push(appleUser.id);

    const googleUser = await findOrCreateGoogleUser({
      id: `google-sub-${randomUUID()}`,
      emails: [{ value: email }],
      name: { givenName: 'Cross', familyName: 'Provider' },
      photos: [],
    });
    expect(googleUser.id).toBe(appleUser.id);
  });
});
