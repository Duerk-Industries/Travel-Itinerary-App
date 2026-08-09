/**
 * E2E: Multi-user trip group invitation flow
 *
 * Tests the complete Owner → Invite → Invitee Accept / Decline lifecycle
 * using two independent browser contexts that share the same server instance.
 *
 * The invite-detection strategy was updated from API-polling to a
 * Socket.IO-driven approach: the invite modal appears automatically once
 * the Socket.IO server pushes a presence/invite notification to the
 * invitee's browser session. The test simply waits for the UI element.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  API_BASE,
  TEST_USER_PASSWORD,
  registerUser,
  loginAsUser,
  loginAsNewUser,
  createTripViaWizard,
} from './fixtures';

// ---------------------------------------------------------------------------
// Helper: wait for the invite modal via UI (Socket.IO pushes updates)
// ---------------------------------------------------------------------------
async function waitForInviteModal(page: Page, timeout = 12_000): Promise<void> {
  await expect(page.getByTestId('invite-modal')).toBeVisible({ timeout });
}

// ---------------------------------------------------------------------------
// Helper: extract JWT from page localStorage (for API calls if needed)
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
// Helper: get first invite ID via API (fallback for extracting testId)
// ---------------------------------------------------------------------------
async function getFirstInviteId(page: Page, token: string): Promise<string | null> {
  const res = await page.request.get(`${API_BASE}/api/groups/invites`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok()) return null;
  const invites: Array<{ id: string }> = await res.json();
  return invites[0]?.id ?? null;
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
    const userBCtx = await browser.newContext();
    const userBPage = await userBCtx.newPage();
    await loginAsUser(userBPage, userB);

    // Wait for invite modal — Socket.IO pushes it on connection
    await waitForInviteModal(userBPage);

    // Get invite ID via API so we can target the right button
    const userBToken = await getToken(userBPage);
    const inviteId = await getFirstInviteId(userBPage, userBToken);
    expect(inviteId, 'Invite should arrive for User B').not.toBeNull();

    // Click "Join" for the invite
    await userBPage.getByTestId(`invite-join-${inviteId}`).click();
    await userBPage.waitForLoadState('networkidle');

    // Modal should close
    await expect(userBPage.getByTestId('invite-modal')).not.toBeVisible({ timeout: 5000 });

    // The trip should now appear as the active trip for User B — the home
    // hero card falls back to "Select a trip" only when no trip is active.
    await expect(userBPage.getByTestId('home-hero-card')).toBeVisible({ timeout: 8000 });
    await expect(userBPage.getByText('Select a trip')).not.toBeVisible();

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

    await waitForInviteModal(userBPage);

    const userBToken = await getToken(userBPage);
    const inviteId = await getFirstInviteId(userBPage, userBToken);
    expect(inviteId).not.toBeNull();

    await userBPage.getByTestId(`invite-decline-${inviteId}`).click();
    await userBPage.waitForLoadState('networkidle');

    // Modal should close
    await expect(userBPage.getByTestId('invite-modal')).not.toBeVisible({ timeout: 5000 });

    // User B should NOT have the trip as active — hero card falls back to
    // "Select a trip" when there is no active trip.
    await expect(userBPage.getByTestId('home-hero-card')).toBeVisible({ timeout: 5000 });
    await expect(userBPage.getByText('Select a trip')).toBeVisible();

    await ownerCtx.close();
    await userBCtx.close();
  });

  test('member added to trip can view trip data after refresh', async ({ browser }) => {
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await loginAsNewUser(ownerPage);
    const userB = await registerUser(ownerPage.request);
    const tripName = await createTripViaWizard(ownerPage, { participantEmail: userB.email });

    const userBCtx = await browser.newContext();
    const userBPage = await userBCtx.newPage();
    await loginAsUser(userBPage, userB);

    await waitForInviteModal(userBPage);

    const userBToken = await getToken(userBPage);
    const inviteId = await getFirstInviteId(userBPage, userBToken);
    expect(inviteId).not.toBeNull();

    await userBPage.getByTestId(`invite-join-${inviteId}`).click();
    await userBPage.waitForLoadState('networkidle');

    // User B reloads — trip should still be active (session persists)
    await userBPage.reload({ waitUntil: 'domcontentloaded' });
    await expect(userBPage.getByTestId('home-hero-card')).toBeVisible({ timeout: 10_000 });
    await expect(userBPage.getByText('Select a trip')).not.toBeVisible();

    // The trip's data should be visible via the picker modal.
    await userBPage.getByTestId('home-hero-card').click();
    await expect(userBPage.getByText(tripName)).toBeVisible({ timeout: 5000 });

    await ownerCtx.close();
    await userBCtx.close();
  });
});
