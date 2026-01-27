/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  moduleNameMapper: {
    '^react-native$': '<rootDir>/tests/__mocks__/react-native.ts',
    '^\\./flightParsing$': '<rootDir>/tabs/flightParsing.web.ts',
  },
  globals: {
    'ts-jest': {
      tsconfig: './tsconfig.json',
    },
  },
};
