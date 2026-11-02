import { expect, test } from '@playwright/test';
import { API_BASE, loginAsUser, openTab, registerUser } from './fixtures';

for (const width of [390, 1280]) {
  test(`R1 personal blog privacy and public reader at ${width}px`, async ({ page, browser }) => {
    await page.setViewportSize({ width, height: 844 });
    const user = await registerUser(page.request);
    const login = await page.request.post(`${API_BASE}/api/web-auth/login`, { data: { email: user.email, password: user.password } });
    expect(login.ok()).toBeTruthy();
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };
    const day = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    const created = await page.request.post(`${API_BASE}/api/trips/wizard`, { headers,
      data: { name: `R1 browser ${width} ${Date.now()}`, startDate: day, endDate: day, participants: [] } });
    expect(created.ok()).toBeTruthy();
    const payload = await created.json(), tripId = payload.trip?.id ?? payload.id;
    const item = await page.request.post(`${API_BASE}/api/trips/${tripId}/blog/items`, { headers,
      data: { kindKey: 'core.text', dayDate: day, body: 'A public story for the R1 browser check.', audience: 'public' } });
    expect(item.ok()).toBeTruthy();
    expect((await page.request.patch(`${API_BASE}/api/account/blog-defaults`, { headers, data: { publicByDefault: false } })).ok()).toBeTruthy();
    await loginAsUser(page, user);
    await openTab(page, 'blog');
    await page.getByTestId('blog-tools-toggle').click();
    await expect(page.getByTestId('blog-publication-check-start')).toContainText('Goes public on');
    await expect(page.getByTestId('blog-make-public-now')).toBeDisabled();
    await page.getByTestId('blog-trip-opt-in').click();
    await expect(page.getByTestId('blog-make-public-now')).toBeEnabled();
    await page.getByTestId('blog-make-public-now').click();
    await expect(page.getByText('Public viewing is on', { exact: true })).toBeVisible();
    const blog = await (await page.request.get(`${API_BASE}/api/trips/${tripId}/blog`, { headers })).json();
    expect(blog.publicPath).toBeTruthy();
    const publicUrl = `${API_BASE}/public/blog${blog.publicPath}`;
    const publicResult = await page.request.get(publicUrl);
    expect(publicResult.status()).toBe(200);
    expect(publicResult.headers()['cache-control']).toContain('no-store');
    const origin = new URL(page.url()).origin;
    const anonymous = await browser.newPage({ viewport: { width, height: 844 } });
    try {
      await anonymous.goto(`${origin}${blog.publicPath}`, { waitUntil: 'domcontentloaded' });
      await expect(anonymous.getByText('A public story for the R1 browser check.', { exact: true })).toBeVisible();
      await page.getByTestId('blog-make-private').click();
      await expect(page.getByTestId('blog-allow-public')).toBeVisible();
      expect((await page.request.get(publicUrl)).status()).toBe(404);
      await anonymous.reload({ waitUntil: 'domcontentloaded' });
      await expect(anonymous.getByText("This trip's story hasn't been shared publicly yet.", { exact: true })).toBeVisible();
      await page.getByTestId('blog-allow-public').click();
      await expect(page.getByText('Public viewing is on', { exact: true })).toBeVisible();
      const profile = await (await page.request.get(`${API_BASE}/api/account/blog-defaults`, { headers })).json();
      expect(profile.publicByDefault).toBe(false);
    } finally { await anonymous.close(); }
  });
}
