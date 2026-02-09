/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['**/__tests__/**/*.test.ts'],
  verbose: false,
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  maxWorkers: 1,
  setupFiles: ['<rootDir>/__tests__/pg-mem-setup.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
};

module.exports = config;
