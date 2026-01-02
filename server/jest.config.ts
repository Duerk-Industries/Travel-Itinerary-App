import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  verbose: false,
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  maxWorkers: 1,
};

export default config;
