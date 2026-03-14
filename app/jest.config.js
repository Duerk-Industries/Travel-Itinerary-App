/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // All test files are in the 'tests' directory, relative to this config file.
  roots: ['<rootDir>/tests'],

  // Look for .test.ts and .test.tsx files within the roots.
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],

  // Ignore the e2e directory to prevent conflicts with Playwright.
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],

  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },

  moduleNameMapper: {
    '^canvas$': '<rootDir>/tests/__mocks__/canvas.ts',
    '^@react-native-community/datetimepicker$': '<rootDir>/tests/__mocks__/@react-native-community/datetimepicker.ts',
    '^@react-navigation/native$': '<rootDir>/tests/__mocks__/@react-navigation/native.ts',
    '^@react-navigation/native-stack$': '<rootDir>/tests/__mocks__/@react-navigation/native-stack.ts',
  },

  // A setup file that runs before each test.
  setupFilesAfterEnv: ['<rootDir>/tests/setupTests.ts'],
};
