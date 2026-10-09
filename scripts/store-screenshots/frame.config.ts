import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'frame.spec.ts', reporter: 'list', workers: 1 });
