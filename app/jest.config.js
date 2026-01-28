/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts', '**/tests/**/*.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  moduleNameMapper: {
    '^react-native$': '<rootDir>/tests/__mocks__/react-native.ts',
    '^@react-native-async-storage/async-storage$': '<rootDir>/tests/__mocks__/asyncStorage.ts',
    '^@react-native-community/datetimepicker$': '<rootDir>/tests/__mocks__/@react-native-community/datetimepicker.ts',
  },
  globals: {
    'ts-jest': {
      tsconfig: './tsconfig.json',
    },
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setupTests.ts'],
};
