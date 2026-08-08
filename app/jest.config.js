/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  maxWorkers: 2,

  // All test files are in the 'tests' directory, relative to this config file.
  roots: ['<rootDir>/tests'],

  // Look for .test.ts and .test.tsx files within the roots.
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],

  // Ignore the e2e directory to prevent conflicts with Playwright.
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],

  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },

  moduleNameMapper: {
    '^canvas$': '<rootDir>/tests/__mocks__/canvas.ts',
    '^@react-native-async-storage/async-storage$': '<rootDir>/tests/__mocks__/@react-native-async-storage/async-storage.ts',
    '^@react-native-community/datetimepicker$': '<rootDir>/tests/__mocks__/@react-native-community/datetimepicker.ts',
    '^@react-navigation/native$': '<rootDir>/tests/__mocks__/@react-navigation/native.ts',
    '^@react-navigation/native-stack$': '<rootDir>/tests/__mocks__/@react-navigation/native-stack.ts',
    '^react-native-safe-area-context$': '<rootDir>/tests/__mocks__/react-native-safe-area-context.ts',
    '^socket\\.io-client$': '<rootDir>/tests/__mocks__/socket.io-client.ts',
    '^react-native-svg$': '<rootDir>/tests/__mocks__/react-native-svg.ts',
    '^@expo/metro-runtime$': '<rootDir>/tests/__mocks__/@expo/metro-runtime.ts',
    '^expo-image-picker$': '<rootDir>/tests/__mocks__/expo-image-picker.ts',
    '^expo-video$': '<rootDir>/tests/__mocks__/expo-video.ts',
  },

  // A setup file that runs before each test.
  setupFilesAfterEnv: ['<rootDir>/tests/setupTests.ts'],
};
