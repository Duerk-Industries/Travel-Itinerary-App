const suppressConsoleForTests = () => {
  if (process.env.SHOW_TEST_LOGS === '1') return;
  if (!(console.log as any)._isMockFunction) jest.spyOn(console, 'log').mockImplementation(() => {});
  if (!(console.info as any)._isMockFunction) jest.spyOn(console, 'info').mockImplementation(() => {});
  if (!(console.warn as any)._isMockFunction) jest.spyOn(console, 'warn').mockImplementation(() => {});
  if (!(console.error as any)._isMockFunction) jest.spyOn(console, 'error').mockImplementation(() => {});
};

beforeEach(suppressConsoleForTests);

// Firestore keeps data between test files, while pg-mem starts every file empty. Wipe the emulator
// project before each file so both behave the same (slugs, emails and counters from an earlier
// file cannot leak into the next). Only ever a throwaway project: a demo-/jest- id on an emulator.
if (process.env.JEST_DB_PROVIDER === 'firebase' && process.env.FIRESTORE_EMULATOR_HOST) {
  const project = process.env.GCLOUD_PROJECT_ID || process.env.GCLOUD_PROJECT || '';
  // The app uses FIRESTORE_DATABASE_ID when set (server/.env often sets it), so clear that database.
  const database = process.env.FIRESTORE_DATABASE_ID || '(default)';
  if (/^(demo-|jest-)/.test(project)) {
    beforeAll(async () => {
      await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/${encodeURIComponent(database)}/documents`, { method: 'DELETE' }).catch(() => undefined);
    });
  }
}
