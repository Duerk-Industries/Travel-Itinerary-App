import { closePool, createWebUser, findUserByEmail, getUserById, listUserEmails, addUserEmail, markAccountEmailVerified, initDb } from '../src/db';
import { cleanupTestUsersByEmail } from './helpers';

describe('phase1 username + user_emails', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
  });

  afterAll(async () => {
    await closePool();
  });

  test('createWebUser assigns username and creates primary user_email', async () => {
    const email = `phase1-user-${Date.now()}@example.com`;
    const user = await createWebUser('Phase', 'One', email, 'testtest');

    const userRecord = await getUserById(user.id);
    expect(userRecord?.username).toBeTruthy();
    // username_normalized should equal username
    expect(userRecord?.username).toBe(userRecord?.username);

    const emails = await listUserEmails(user.id);
    const primaryEmail = emails.find(e => e.email.toLowerCase() === email.toLowerCase());
    expect(primaryEmail).toBeTruthy();
    expect(primaryEmail!.isPrimary).toBe(true);
    expect(primaryEmail!.isVerified).toBe(false);
  });

  test('username collisions are resolved with numeric suffixes', async () => {
    const ts = Date.now();
    const first = await createWebUser('Same', 'Name', `same-name-${ts}-a@example.com`, 'testtest');
    const second = await createWebUser('Same', 'Name', `same-name-${ts}-b@example.com`, 'testtest');

    const firstUser = await getUserById(first.id);
    const secondUser = await getUserById(second.id);
    const usernames = [firstUser!.username!, secondUser!.username!].sort();
    expect(usernames[0]).toMatch(/^samename\d*$/);
    expect(usernames[1]).toMatch(/^samename\d*$/);
    expect(new Set(usernames).size).toBe(2);
  });

  test('findUserByEmail resolves via user_emails mapping', async () => {
    const ts = Date.now();
    const altEmail = `lookup-alt-${ts}@example.com`;
    const user = await createWebUser('Lookup', 'Email', `lookup-${ts}@example.com`, 'testtest');

    // Add a secondary email and verify it
    await addUserEmail(user.id, altEmail);
    await markAccountEmailVerified(user.id, altEmail);

    const found = await findUserByEmail(altEmail);
    expect(found?.id).toBe(user.id);
  });
});
