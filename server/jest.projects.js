/** @type {import('jest').Config} */
const path = require('node:path');
const tsJestTransformer = require.resolve('ts-jest', {
  paths: [path.resolve(__dirname, '..')],
});

const commonProjectConfig = {
  testEnvironment: 'node',
  rootDir: __dirname,
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  maxWorkers: 1,
  transform: {
    '^.+\\.(ts|tsx)$': [tsJestTransformer, { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
};

module.exports = {
  projects: [
    {
      ...commonProjectConfig,
      displayName: 'firebase',
      testMatch: ['**/__tests__/**/*.test.ts'],
      setupFiles: ['<rootDir>/__tests__/jest-setup.ts'],
      setupFilesAfterEnv: ['<rootDir>/__tests__/jest-after-env.ts'],
    },
  ],
};
