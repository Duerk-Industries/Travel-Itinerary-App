/** @type {import('jest').Config} */
const commonProjectConfig = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  maxWorkers: 1,
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
};

module.exports = {
  projects: [
    {
      ...commonProjectConfig,
      displayName: 'firebase',
      testMatch: ['**/__tests__/**/*.test.ts'],
      setupFiles: ['<rootDir>/__tests__/firebase-default-setup.ts'],
    },
  ],
};
