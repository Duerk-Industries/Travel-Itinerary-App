/** @type {import('jest').Config} */
const legacyMemoryTestFiles = [
  '<rootDir>/__tests__/account.test.ts',
  '<rootDir>/__tests__/admin-bootstrap.test.ts',
  '<rootDir>/__tests__/admin-routes.test.ts',
  '<rootDir>/__tests__/costReport.test.ts',
  '<rootDir>/__tests__/crud-delete.test.ts',
  '<rootDir>/__tests__/expense-sync.test.ts',
  '<rootDir>/__tests__/expenses.test.ts',
  '<rootDir>/__tests__/group-member-removal.test.ts',
  '<rootDir>/__tests__/group-members-pending.test.ts',
  '<rootDir>/__tests__/itinerary-limits.test.ts',
  '<rootDir>/__tests__/itinerary-traits.test.ts',
  '<rootDir>/__tests__/itineraryImages.test.ts',
  '<rootDir>/__tests__/ledger-integration.test.ts',
  '<rootDir>/__tests__/lodging.test.ts',
  '<rootDir>/__tests__/overview-transfers.test.ts',
  '<rootDir>/__tests__/phase1-user-identity.test.ts',
  '<rootDir>/__tests__/phase2-auth-identifier-multi-email.test.ts',
  '<rootDir>/__tests__/tiers-limits.test.ts',
  '<rootDir>/__tests__/transfers.test.ts',
  '<rootDir>/__tests__/trip-activity.test.ts',
  '<rootDir>/__tests__/trip-following.test.ts',
  '<rootDir>/__tests__/trip-wizard.test.ts',
  '<rootDir>/__tests__/usage-tracking.test.ts',
  '<rootDir>/__tests__/db-provider.test.ts',
];

const firebaseIgnorePatterns = legacyMemoryTestFiles.map((file) =>
  file.replace('<rootDir>', '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'
);

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  maxWorkers: 1,
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: firebaseIgnorePatterns,
  setupFiles: ['<rootDir>/__tests__/firebase-default-setup.ts'],
};
