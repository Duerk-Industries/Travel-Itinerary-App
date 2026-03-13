/**
 * E2E: Multi-user trip group invitation flow
 *
 * Tests the complete Owner → Invite → Invitee Accept / Decline lifecycle
 * using two independent browser contexts that share the same server instance.
 *
 * Because the app has NO real-time push (no WebSockets / SSE), invitee data
 * is polled via the API after the owner's actions rather than relying on
 * live UI updates. See docs/realtime-sync-recommendation.md for the upgrade path.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  API_BASE,
  TEST_USER_PASSWORD,
  registerUser,
  loginAsUser,
  loginAsNewUser,
  createTripViaWizard,
  createSecondUserContext,
} from './fixtures';

// ---------------------------------------------------------------------------
// Helper: wait for the invitee's invite list to be non-empty via API polling
// ---------------------------------------------------------------------------
async function waitForInvite(
  page: Page,
  token: string,
  maxWaitMs = 5000,
): Promise<string | null> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const res = await page.request.get(`${API_BASE}/api/groups/invites`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok()) {
      const invites: Array<{ id: string }> = await res.json();
      if (invites.length) return invites[0].id;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper: extract JWT from page localStorage
// ---------------------------------------------------------------------------
async function getToken(page: Page): Promise<string> {
  const token = await page.evaluate((): string | null => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      const val = localStorage.getItem(key) ?? '';
      if (val.startsWith('eyJ')) return val;
    }
    return null;
  });
  if (!token) throw new Error('No JWT found in localStorage');
  return token;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Multi-User Group Invitation', () => {
  test('owner invites user; invitee sees trip after accepting', async ({ browser }) => {
    // --- Context 1: Owner ---
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await loginAsNewUser(ownerPage);

    // Pre-register User B so we know their email
    const userB = await registerUser(ownerPage.request);

    // Owner creates a trip and invites User B by email
    await createTripViaWizard(ownerPage, { participantEmail: userB.email });

    // --- Context 2: User B ---
    const { context: userBCtx, page: userBPage } = await createSecondUserContext(browser, {
      email: userB.email,
      username: userB.username,
      password: TEST_USER_PASSWORD,
      firstName: userB.firstName,
      lastName: userB.lastName,
    });

    // Actually, User B was pre-registered; we just need to log in
    await loginAsUser(userBPage, userB);
    const userBToken = await getToken(userBPage);

    // Poll API until invite arrives (max 5 s)
    const inviteId = await waitForInvite(userBPage, userBToken);
    expect(inviteId, 'Invite should arrive for User B').not.toBeNull();

    // The pending invite modal should show automatically on first login
    await expect(userBPage.getByTestId('invite-modal')).toBeVisible({ timeout: 8000 });

    // Click "Join" for the invite
    await userBPage.getByTestId(`invite-join-${inviteId}`).click();
    await userBPage.waitForLoadState('networkidle');

    // Modal should close
    await expect(userBPage.getByTestId('invite-modal')).not.toBeVisible({ timeout: 5000 });

    // The trip should now appear as the active trip for User B
    await expect(userBPage.getByText(/Active Trip:/i)).toBeVisible({ timeout: 8000 });

    await ownerCtx.close();
    await userBCtx.close();
  });

  test('invitee can decline an invitation', async ({ browser }) => {
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await loginAsNewUser(ownerPage);

    const userB = await registerUser(ownerPage.request);
    await createTripViaWizard(ownerPage, { participantEmail: userB.email });

    const userBCtx = await browser.newContext();
    const userBPage = await userBCtx.newPage();
    await loginAsUser(userBPage, userB);
    const userBToken = await getToken(userBPage);

    const inviteId = await waitForInvite(userBPage, userBToken);
    expect(inviteId).not.toBeNull();

    await expect(userBPage.getByTestId('invite-modal')).toBeVisible({ timeout: 8000 });
    await userBPage.getByTestId(`invite-decline-${inviteId}`).click();
    await userBPage.waitForLoadState('networkidle');

    // Modal should close
    await expect(userBPage.getByTestId('invite-modal')).not.toBeVisible({ timeout: 5000 });

    // User B should NOT have the trip as active
    const tripVisible = await userBPage.getByText(/Active Trip:/i).isVisible({ timeout: 3000 }).catch(() => false);
    expect(tripVisible).toBeFalsy();

    await ownerCtx.close();
    await userBCtx.close();
  });

  test('member added to trip can view trip data after refresh', async ({ browser }) => {
    // Owner creates trip and invites User B
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await loginAsNewUser(ownerPage);
    const userB = await registerUser(ownerPage.request);
    const tripName = await createTripViaWizard(ownerPage, { participantEmail: userB.email });

    // User B logs in and accepts
    const userBCtx = await browser.newContext();
    const userBPage = await userBCtx.newPage();
    await loginAsUser(userBPage, userB);
    const userBToken = await getToken(userBPage);
    const inviteId = await waitForInvite(userBPage, userBToken);
    expect(inviteId).not.toBeNull();

    await expect(userBPage.getByTestId('invite-modal')).toBeVisible({ timeout: 8000 });
    await userBPage.getByTestId(`invite-join-${inviteId}`).click();
    await userBPage.waitForLoadState('networkidle');

    // User B reloads — trip should still be active (session persists)
    await userBPage.reload({ waitUntil: 'domcontentloaded' });
    await expect(userBPage.getByText(`Active Trip: ${tripName}`)).toBeVisible({ timeout: 10_000 });

    await ownerCtx.close();
    await userBCtx.close();
  });
});
