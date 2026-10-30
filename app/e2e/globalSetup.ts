import { chromium, expect, type FullConfig } from '@playwright/test';

/** Compile and render the real app once before tests start measuring interactions. */
export default async function globalSetup(config: FullConfig) {
  const use = config.projects[0].use;
  const browser = await chromium.launch({ channel: use.channel });
  try {
    const page = await browser.newPage();
    await page.goto(String(use.baseURL), { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await expect(page.getByRole('button', { name: 'Log In', exact: true })).toBeVisible({ timeout: 90_000 });
  } finally {
    await browser.close();
  }
}
