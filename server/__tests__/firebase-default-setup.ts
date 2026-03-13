// Default server test bootstrap: prefer the Firebase adapter unless a test opts into
// a different provider explicitly.

jest.setTimeout(30000);

if (process.env.SHOW_TEST_LOGS !== '1') {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
}

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.DB_PROVIDER = process.env.DB_PROVIDER ?? 'firebase';
process.env.GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID ?? 'jest-firebase-test-project';

if (!process.env.DB_PROVIDER || process.env.DB_PROVIDER === 'firebase') {
  delete process.env.USE_IN_MEMORY_DB;
}
