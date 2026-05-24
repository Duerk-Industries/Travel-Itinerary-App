import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate, createToken } from '../auth';
import { getUserRole, writeAuditLog } from '../db';
import {
  deleteWebUserAndCleanup,
  acceptFamilyRelationship,
  createFamilyRelationship,
  listFamilyRelationships,
  rejectFamilyRelationship,
  removeFamilyRelationship,
  getWebUserProfile,
  setInitialWebUserPassword,
  updateWebUserPassword,
  updateFamilyProfile,
  updateWebUserProfile,
  listFellowTravelers,
  createFellowTraveler,
  updateFellowTraveler,
  removeFellowTraveler,
  addGroupMember,
  createGroupWithMembers,
  attachInviteToTrip,
  listGroupInvitesForUser,
  listGroupsForUser,
  removeGroupMember,
  searchUsersByEmail,
  deleteGroup,
  listGroupMembers,
  ensureUserInTrip,
  removeGroupInvite,
  acceptGroupInvite,
  rejectGroupInvite,
  getTripById,
  listUserEmails,
  addUserEmail,
  createUserEmailVerification,
  setPrimaryUserEmail,
  removeUserEmail,
  getUserPackingList,
  replaceUserPackingList,
} from '../db';
import { sendShareEmailBestEffort, sendTripInviteEmailBestEffort, sendVerificationEmailBestEffort } from '../mailer';
import { logError } from '../logger';
import { getAuthFlag } from '../config/authFlags';
import { assertUnderTravelerLimit, canUseFeature } from '../services/entitlementService';
import { EntitlementError } from '../errors';
import { TokenPayload } from '../auth';
import { deleteUserIngestionData } from '../ingestion/shared/repository';
import { buildUserDataExport } from '../services/userDataExport';
import { accountPasswordRateLimit } from '../services/httpRateLimitService';

// Account management (profile, password, deletion) for authenticated web users.
const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

const ensureUserInGroup = async (groupId: string, userId: string): Promise<boolean> => {
  const groups = await listGroupsForUser(userId);
  return groups.some((group: any) => String(group.id) === String(groupId));
};

/**
 * Fire-and-forget audit write for account self-service mutations. Never
 * throws — a failed audit write must not fail the underlying mutation.
 */
const auditAccountAction = async (params: {
  userId: string;
  action: string;
  afterState?: Record<string, unknown>;
  beforeState?: Record<string, unknown>;
  reason: string;
}): Promise<void> => {
  try {
    await writeAuditLog({
      actorUserId: params.userId,
      targetUserId: params.userId,
      action: params.action as any,
      beforeState: params.beforeState,
      afterState: params.afterState,
      reason: params.reason,
    });
  } catch (err) {
    logError('[account] audit write failed', err);
  }
};

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  const profile = await getWebUserProfile(userId);
  if (!profile) {
    res.status(401).json({ error: 'User not found' });
    return;
  }
  const costTracking = await canUseFeature(userId, 'cost_tracking', role);
  res.json({ ...profile, entitlements: { costTracking } });
});

router.get('/packing-list', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    const items = await getUserPackingList(userId);
    res.json({ items });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.put('/packing-list', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    const items = await replaceUserPackingList(userId, Array.isArray(req.body?.items) ? req.body.items : []);
    res.json({ items });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/export', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const profile = await getWebUserProfile(userId);
  if (!profile) {
    res.status(401).json({ error: 'User not found' });
    return;
  }
  try {
    const exportBody = await buildUserDataExport(userId);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="wanderbunnies-export-${userId}.json"`,
    );
    res.json(exportBody);
  } catch (err) {
    logError('[account] export failed', err);
    res.status(500).json({ error: 'Failed to generate export.' });
  }
});

router.patch('/profile', async (req, res) => {
  const user = (req as any).user as { userId: string; email: string };
  const body = req.body ?? {};
  const { firstName, lastName, email, homeAddress, preferredAirport, mapPreference, appearancePreference, temperatureUnit } = req.body ?? {};
  const hasAnyProfileField = ['firstName', 'lastName', 'email', 'homeAddress', 'preferredAirport', 'mapPreference', 'appearancePreference', 'temperatureUnit'].some((key) =>
    Object.prototype.hasOwnProperty.call(body, key)
  );
  if (!hasAnyProfileField) {
    res.status(400).json({ error: 'At least one field is required' });
    return;
  }
  try {
    const updated = await updateWebUserProfile(user.userId, {
      firstName: typeof firstName === 'string' ? firstName.trim() : undefined,
      lastName: typeof lastName === 'string' ? lastName.trim() : undefined,
      email: typeof email === 'string' ? email.trim().toLowerCase() : undefined,
      homeAddress: typeof homeAddress === 'string' ? homeAddress.trim() : undefined,
      preferredAirport: typeof preferredAirport === 'string' ? preferredAirport.trim() : undefined,
      mapPreference: typeof mapPreference === 'string' ? mapPreference.trim().toLowerCase() : undefined,
      appearancePreference: typeof appearancePreference === 'string' ? appearancePreference.trim().toLowerCase() : undefined,
      temperatureUnit: typeof temperatureUnit === 'string' ? temperatureUnit.trim().toLowerCase() : undefined,
    });
    const role = await getUserRole(updated.id);
    const token = createToken({ userId: updated.id, email: updated.email, provider: 'email', role });
    res.json({ user: updated, token });
  } catch (err: any) {
    if (err?.code === 'EMAIL_TAKEN') {
      res.status(409).json({ error: 'Email already in use' });
      return;
    }
    if (err?.code === 'EMAIL_NOT_VERIFIED') {
      res.status(400).json({ error: 'Email must be linked and verified before setting it as primary.' });
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/emails', async (req, res) => {
  if (!getAuthFlag('multiEmailEnabled')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const userId = (req as any).user.userId as string;
  const emails = await listUserEmails(userId);
  res.json({ emails });
});

router.post('/emails', async (req, res) => {
  if (!getAuthFlag('multiEmailEnabled')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const userId = (req as any).user.userId as string;
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: 'email is required' });
    return;
  }
  try {
    const added = await addUserEmail(userId, email);
    const verification = await createUserEmailVerification(userId, email);
    await sendVerificationEmailBestEffort(added.email, verification.token, {
      path: '/confirm-email',
      subject: 'Confirm your added WanderBunnies email',
      intro: 'Please confirm this email address to use it for sign-in on your WanderBunnies account.',
    });
    await auditAccountAction({
      userId,
      action: 'ACCOUNT_EMAIL_ADDED',
      afterState: { email: added.email, verified: Boolean(added.verifiedAt) },
      reason: 'User added a secondary email',
    });
    res.status(201).json({ email: added, verificationRequired: true, verificationToken: process.env.NODE_ENV === 'test' ? verification.token : undefined });
  } catch (err: any) {
    if (err?.code === 'EMAIL_TAKEN') {
      res.status(409).json({ error: 'Email already in use' });
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/emails/:email/resend-verification', async (req, res) => {
  if (!getAuthFlag('multiEmailEnabled')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const userId = (req as any).user.userId as string;
  const email = String(req.params.email ?? '').trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: 'email is required' });
    return;
  }
  try {
    const verification = await createUserEmailVerification(userId, email);
    await sendVerificationEmailBestEffort(email, verification.token, {
      path: '/confirm-email',
      subject: 'Confirm your added WanderBunnies email',
      intro: 'Please confirm this email address to use it for sign-in on your WanderBunnies account.',
    });
    res.json({ message: 'Verification sent', verificationToken: process.env.NODE_ENV === 'test' ? verification.token : undefined });
  } catch (err: any) {
    if (err?.code === 'EMAIL_NOT_FOUND') {
      res.status(404).json({ error: 'Email not found' });
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  }
});

router.patch('/emails/primary', async (req, res) => {
  if (!getAuthFlag('multiEmailEnabled')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const userId = (req as any).user.userId as string;
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: 'email is required' });
    return;
  }
  try {
    const emails = await setPrimaryUserEmail(userId, email);
    const profile = await getWebUserProfile(userId);
    const role = profile ? await getUserRole(profile.id) : null;
    const token = profile && role ? createToken({ userId: profile.id, email: profile.email, provider: 'email', role }) : null;
    await auditAccountAction({
      userId,
      action: 'ACCOUNT_EMAIL_PRIMARY_CHANGED',
      afterState: { primaryEmail: email },
      reason: 'User changed primary email',
    });
    res.json({ emails, token });
  } catch (err: any) {
    if (err?.code === 'EMAIL_NOT_VERIFIED') {
      res.status(400).json({ error: 'Email must be verified before it can become primary.' });
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/emails/:email', async (req, res) => {
  if (!getAuthFlag('multiEmailEnabled')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const userId = (req as any).user.userId as string;
  const email = String(req.params.email ?? '').trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: 'email is required' });
    return;
  }
  try {
    const emails = await removeUserEmail(userId, email);
    await auditAccountAction({
      userId,
      action: 'ACCOUNT_EMAIL_REMOVED',
      afterState: { removedEmail: email, remainingCount: emails.length },
      reason: 'User removed a secondary email',
    });
    res.json({ emails });
  } catch (err: any) {
    if (err?.code === 'PRIMARY_EMAIL_IMMUTABLE') {
      res.status(400).json({ error: 'Primary email cannot be deleted.' });
      return;
    }
    if (err?.code === 'LAST_VERIFIED_EMAIL_REQUIRED') {
      res.status(400).json({ error: 'At least one verified email must remain on this account.' });
      return;
    }
    if (err?.code === 'EMAIL_NOT_FOUND') {
      res.status(404).json({ error: 'Email not found' });
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  }
});

router.patch('/password', accountPasswordRateLimit, async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { currentPassword, newPassword, newPasswordConfirm } = req.body ?? {};
  if (!newPassword || !newPasswordConfirm) {
    res.status(400).json({ error: 'newPassword and newPasswordConfirm are required' });
    return;
  }
  if (String(newPassword).length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters' });
    return;
  }
  if (newPassword !== newPasswordConfirm) {
    res.status(400).json({ error: 'Passwords do not match' });
    return;
  }
  try {
    const mode = typeof currentPassword === 'string' && currentPassword.trim().length > 0 ? 'change' : 'initial_setup';
    if (mode === 'change') {
      await updateWebUserPassword(userId, currentPassword, newPassword);
    } else {
      await setInitialWebUserPassword(userId, newPassword);
    }
    await auditAccountAction({
      userId,
      action: 'ACCOUNT_PASSWORD_CHANGED',
      afterState: { mode },
      reason: mode === 'change' ? 'User rotated their password' : 'User set initial password',
    });
    res.json({ message: 'Password updated' });
  } catch (err: any) {
    if (err?.code === 'INVALID_PASSWORD') {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }
    if (err?.code === 'PASSWORD_SETUP_NOT_REQUIRED') {
      res.status(400).json({ error: 'Current password is required to change password.' });
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/family', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const relationships = await listFamilyRelationships(userId);
  res.json(relationships);
});

router.get('/fellow-travelers', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const travelers = await listFellowTravelers(userId);
  res.json(travelers);
});

router.post('/fellow-travelers', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { firstName, lastName, email } = req.body ?? {};
  try {
    await createFellowTraveler(userId, String(firstName ?? ''), String(lastName ?? ''), email == null ? null : String(email));
    const travelers = await listFellowTravelers(userId);
    res.status(201).json(travelers);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/fellow-travelers/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { firstName, lastName, email } = req.body ?? {};
  try {
    await updateFellowTraveler(userId, req.params.id, String(firstName ?? ''), String(lastName ?? ''), email == null ? null : String(email));
    const travelers = await listFellowTravelers(userId);
    res.json(travelers);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/fellow-travelers/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await removeFellowTraveler(userId, req.params.id);
    const travelers = await listFellowTravelers(userId);
    res.json(travelers);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/family', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { givenName, middleName, familyName, email, relationship } = req.body ?? {};
  try {
    await createFamilyRelationship(userId, { givenName, middleName, familyName, email, relationship });
    const relationships = await listFamilyRelationships(userId);
    res.status(201).json(relationships);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/family/:id/accept', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await acceptFamilyRelationship(userId, req.params.id);
    const relationships = await listFamilyRelationships(userId);
    res.json(relationships);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/family/:id/reject', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await rejectFamilyRelationship(userId, req.params.id);
    const relationships = await listFamilyRelationships(userId);
    res.json(relationships);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/family/:id/profile', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { givenName, middleName, familyName, email, relationship } = req.body ?? {};
  try {
    await updateFamilyProfile(userId, req.params.id, { givenName, middleName, familyName, email, relationship });
    const relationships = await listFamilyRelationships(userId);
    res.json(relationships);
  } catch (err: any) {
    if (err?.code === 'EMAIL_TAKEN') {
      res.status(409).json({ error: 'Email already in use' });
      return;
    }
    res.status(400).json({ error: err.message });
  }
});

router.delete('/family/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await removeFamilyRelationship(userId, req.params.id);
    const relationships = await listFamilyRelationships(userId);
    res.json(relationships);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    // Audit BEFORE the cascade so we keep a durable record of the request
    // even if the delete aborts. `ON DELETE SET NULL` on the FK means a
    // successful cascade will null out actor/target while preserving the
    // action + reason text.
    await auditAccountAction({
      userId,
      action: 'ACCOUNT_DELETED',
      reason: 'User initiated account deletion',
    });
    await deleteUserIngestionData(userId).catch(() => undefined);
    if (process.env.USE_IN_MEMORY_DB === '1') {
      const p = require('../db').poolClient();
      try {
        await p.query('BEGIN');

        // Reassign groups the user owns when possible; otherwise clean up the group and its trips.
        const ownedGroupsRes = await p.query(`SELECT id FROM groups WHERE owner_id = $1`, [userId]);

        for (const g of ownedGroupsRes.rows) {
          const memberSnapshot = await p.query(`SELECT id, user_id as "userId", guest_name as "guestName" FROM group_members WHERE group_id = $1`, [g.id]);
          const newOwner =
            (memberSnapshot.rows as Array<{ userId: string | null }>).find(
              (m) => m.userId && m.userId !== userId
            )?.userId ?? null;

          if (newOwner) {
            await p.query(`UPDATE groups SET owner_id = $2 WHERE id = $1`, [g.id, newOwner]);
          } else {
            const tripRows = await p.query(`SELECT id FROM trips WHERE group_id = $1`, [g.id]);
            const tripIds = (tripRows.rows as Array<{ id: string }>).map((t) => t.id);
            if (tripIds.length) {
              await p.query(`DELETE FROM flights WHERE trip_id = ANY($1::uuid[])`, [tripIds]);
              await p.query(`DELETE FROM lodgings WHERE trip_id = ANY($1::uuid[])`, [tripIds]);
              await p.query(`DELETE FROM tours WHERE trip_id = ANY($1::uuid[])`, [tripIds]);
              await p.query(`DELETE FROM expenses WHERE trip_id = ANY($1::uuid[])`, [tripIds]);
              await p.query(`DELETE FROM itineraries WHERE trip_id = ANY($1::uuid[])`, [tripIds]);
              await p.query(`DELETE FROM trips WHERE id = ANY($1::uuid[])`, [tripIds]);
            }
            await p.query(`DELETE FROM group_invites WHERE group_id = $1`, [g.id]);
            await p.query(`DELETE FROM group_members WHERE group_id = $1`, [g.id]);
            await p.query(`DELETE FROM groups WHERE id = $1`, [g.id]);
          }
        }

        // Remove memberships and invites for the user.
        const membershipsToUpdate = await p.query(`SELECT id, group_id, user_id, added_by FROM group_members WHERE added_by = $1`, [userId]);
        for (const m of membershipsToUpdate.rows as Array<{ id: string; group_id: string; user_id: string | null; added_by: string | null }> ) {
          const ownerRes = await p.query(`SELECT owner_id FROM groups WHERE id = $1`, [m.group_id]);
          const ownerIdForGroup = ownerRes.rows[0]?.owner_id ?? null;
          const newAddedBy = ownerIdForGroup ?? m.user_id ?? m.added_by ?? userId;
          await p.query(`UPDATE group_members SET added_by = $2 WHERE id = $1`, [m.id, newAddedBy]);
        }
        await p.query(`DELETE FROM group_members WHERE user_id = $1`, [userId]);
        await p.query(`DELETE FROM group_invites WHERE invitee_user_id = $1`, [userId]);

        // Remove user-owned rows.
        await p.query(`DELETE FROM flight_shares WHERE user_id = $1 OR flight_id IN (SELECT id FROM flights WHERE user_id = $1)`, [userId]);
        await p.query(`DELETE FROM flights WHERE user_id = $1`, [userId]);
        await p.query(`DELETE FROM lodgings WHERE user_id = $1`, [userId]);
        await p.query(`DELETE FROM tours WHERE user_id = $1`, [userId]);
        await p.query(`DELETE FROM expenses WHERE user_id = $1`, [userId]);
        await p.query(`DELETE FROM traits WHERE user_id = $1`, [userId]);
        await p.query(`DELETE FROM family_relationships WHERE requester_id = $1 OR relative_id = $1`, [userId]);

        await p.query(`DELETE FROM web_users WHERE id = $1`, [userId]);
        await p.query(`DELETE FROM users WHERE id = $1`, [userId]);

        await p.query('COMMIT');
        res.status(204).send();
        return;
      } catch (err) {
        await p.query('ROLLBACK').catch(() => {});
        throw err;
      }
    }

    await deleteWebUserAndCleanup(userId);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/trips/:tripId/members', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const membership = await ensureUserInTrip(req.params.tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'Not authorized to view members for this trip' });
    return;
  }
  try {
    const members = await listGroupMembers(membership.groupId, userId);
    res.json(members);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/trips/:tripId/members', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  const membership = await ensureUserInTrip(req.params.tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'Not authorized to add members to this trip' });
    return;
  }
  const { email, guestName, firstName, lastName } = req.body as {
    email?: string;
    guestName?: string;
    firstName?: string;
    lastName?: string;
  };
  try {
    await assertUnderTravelerLimit(userId, membership.groupId, role);
    const result = await addGroupMember(userId, membership.groupId, { email, guestName, firstName, lastName });
    if (result.inviteId) {
      await attachInviteToTrip(result.inviteId, req.params.tripId);
    }
    if (result.email) {
      const trip = await getTripById(req.params.tripId);
      const tripName = trip?.name ?? 'Trip';
      const inviterEmail = (req as any).user?.email as string | undefined;
      await sendTripInviteEmailBestEffort(result.email, tripName, inviterEmail ?? null).catch(() => undefined);
    }
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/trips/:tripId/members/:memberId', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const membership = await ensureUserInTrip(req.params.tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'Not authorized to remove members from this trip' });
    return;
  }
  try {
    try {
      await removeGroupMember(userId, membership.groupId, req.params.memberId);
      res.status(204).send();
      return;
    } catch (err) {
      if ((err as Error).message === 'Member not found') {
        await removeGroupInvite(userId, req.params.memberId);
        res.status(204).send();
        return;
      }
      throw err;
    }
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Groups API (moved from groupRoutes.ts) for managing groups, members, invites, and sharing.
export const groupsRouter = Router();
groupsRouter.use(bodyParser.json());
groupsRouter.use(authenticate);

groupsRouter.get('/invites', async (req, res) => {
  const user = (req as any).user as { userId: string; email: string };
  try {
    const invites = await listGroupInvitesForUser(user.userId, user.email);
    res.json(invites);
  } catch (err) {
    logError('Failed to list group invites', err);
    res.status(503).json({ error: 'Invites temporarily unavailable. Please try again.' });
  }
});

groupsRouter.post('/invites/:id/accept', async (req, res) => {
  const user = (req as any).user as { userId: string; email: string };
  try {
    await acceptGroupInvite(req.params.id, user.userId, user.email);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

groupsRouter.post('/invites/:id/reject', async (req, res) => {
  const user = (req as any).user as { userId: string; email: string };
  try {
    await rejectGroupInvite(req.params.id, user.userId, user.email);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

groupsRouter.get('/search-users', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) {
    res.json([]);
    return;
  }
  const users = await searchUsersByEmail(q);
  res.json(users);
});

groupsRouter.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const sort = String(req.query.sort ?? 'created') === 'name' ? 'name' : 'created';
  const groups = await listGroupsForUser(userId, sort as any);
  res.json(groups);
});

groupsRouter.post('/', async (req, res) => {
  const user = (req as any).user as { userId: string; email: string };
  const { name, members } = req.body as { name?: string; members?: Array<{ email?: string; guestName?: string }> };

  if (!name || !name.trim()) {
    res.status(400).json({ error: 'Group name is required' });
    return;
  }

  const normalizedMembers = Array.isArray(members) ? members : [];
  try {
    const { groupId, invites } = await createGroupWithMembers(user.userId, name.trim(), normalizedMembers);

    await Promise.all(
      invites.map(({ email }) => {
        const subject = `${user.email} invited you to a group: ${name}`;
        const body = [
          `Hi,`,
          ``,
          `${user.email} invited you to join the group "${name}".`,
          `Log in to Shared Trip Planner to accept this invitation.`, 
        ].join('\n');
        return sendShareEmailBestEffort(email, subject, body).catch(() => undefined);
      })
    );

    res.status(201).json({ id: groupId, invites });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

groupsRouter.post('/:id/members', async (req, res) => {
  const user = (req as any).user as TokenPayload & { userId: string; email: string };
  if (!(await ensureUserInGroup(req.params.id, user.userId))) {
    res.status(403).json({ error: 'Not authorized to add members to this group' });
    return;
  }
  const { email, guestName, firstName, lastName } = req.body as { email?: string; guestName?: string; firstName?: string; lastName?: string };
  const given = typeof firstName === 'string' ? firstName.trim() : '';
  const family = typeof lastName === 'string' ? lastName.trim() : '';
  if ((firstName !== undefined || lastName !== undefined) && (!given || !family)) {
    res.status(400).json({ error: 'firstName and lastName cannot be blank' });
    return;
  }
  const normalizedGuestName = guestName?.trim() || (given && family ? `${given} ${family}` : undefined);
  try {
    await assertUnderTravelerLimit(user.userId, req.params.id, user.role);
    const result = await addGroupMember(user.userId, req.params.id, {
      email,
      guestName: normalizedGuestName,
      firstName: given || undefined,
      lastName: family || undefined,
    });
    if (result.email && result.inviteId) {
      const subject = `${user.email} invited you to a group`;
      const body = `${user.email} invited you to join a group. Log in to accept.`;
      await sendShareEmailBestEffort(result.email, subject, body);
    }
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  }
});

groupsRouter.delete('/:groupId/members/:memberId', async (req, res) => {
  const user = (req as any).user as { userId: string };
  if (!(await ensureUserInGroup(req.params.groupId, user.userId))) {
    res.status(403).json({ error: 'Not authorized to remove members from this group' });
    return;
  }
  try {
    await removeGroupMember(user.userId, req.params.groupId, req.params.memberId);
    res.status(204).send();
  } catch (err) {
    if ((err as Error).message === 'Member not found') {
      await removeGroupInvite(user.userId, req.params.memberId);
      res.status(204).send();
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  }
});

groupsRouter.get('/:id/members', async (req, res) => {
  const user = (req as any).user as { userId: string };
  if (!(await ensureUserInGroup(req.params.id, user.userId))) {
    res.status(403).json({ error: 'Not authorized to view members for this group' });
    return;
  }
  try {
    const members = await listGroupMembers(req.params.id, user.userId);
    res.json(members);
  } catch (err) {
    logError('[groups] failed to list group members', {
      groupId: req.params.id,
      userId: user.userId,
      error: (err as Error).message,
    });
    res.status(400).json({ error: (err as Error).message });
  }
});

groupsRouter.delete('/invites/:id', async (req, res) => {
  const user = (req as any).user as { userId: string };
  try {
    await removeGroupInvite(user.userId, req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/**
 * Bulk-cancel pending invites the caller owns. Each invite is processed
 * independently so one bad id (already-accepted, not-owned, etc.) does not
 * block the others. Returns `{ cancelled, failed }` so the client can show
 * which ones couldn't be removed without re-reading the full invite list.
 */
groupsRouter.post('/invites/bulk-cancel', async (req, res) => {
  const user = (req as any).user as { userId: string };
  const rawIds = req.body?.inviteIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    res.status(400).json({ error: 'inviteIds must be a non-empty array.' });
    return;
  }
  const inviteIds = rawIds
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter((id) => id.length > 0);
  if (inviteIds.length === 0) {
    res.status(400).json({ error: 'inviteIds must contain at least one non-empty string.' });
    return;
  }
  const cancelled: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const id of inviteIds) {
    try {
      await removeGroupInvite(user.userId, id);
      cancelled.push(id);
    } catch (err) {
      failed.push({ id, error: (err as Error).message });
    }
  }
  res.json({ cancelled: cancelled.length, failed: failed.length, cancelledIds: cancelled, failedIds: failed });
});

groupsRouter.delete('/:id', async (req, res) => {
  const user = (req as any).user as { userId: string };
  if (!(await ensureUserInGroup(req.params.id, user.userId))) {
    res.status(403).json({ error: 'Not authorized to delete this group' });
    return;
  }
  try {
    await deleteGroup(user.userId, req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
