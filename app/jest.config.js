/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts', '**/tests/**/*.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: './tsconfig.json' }],
  },
  moduleNameMapper: {
    '^react-native$': '<rootDir>/tests/__mocks__/react-native.ts',
    '^\\./flightParsing$': '<rootDir>/tabs/flightParsing.web.ts',
    '^@react-native-async-storage/async-storage$': '<rootDir>/tests/__mocks__/@react-native-async-storage/async-storage.ts',
    '^@react-native-community/datetimepicker$': '<rootDir>/tests/__mocks__/@react-native-community/datetimepicker.ts',
    '^@react-navigation/native$': '<rootDir>/tests/__mocks__/@react-navigation/native.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setupTests.ts'],
};
