import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate, createToken } from '../auth';
import {
  deleteWebUserAndCleanup,
  acceptFamilyRelationship,
  createFamilyRelationship,
  listFamilyRelationships,
  rejectFamilyRelationship,
  removeFamilyRelationship,
  getWebUserProfile,
  updateWebUserPassword,
  updateFamilyProfile,
  updateWebUserProfile,
  listFellowTravelers,
  createFellowTraveler,
  updateFellowTraveler,
  removeFellowTraveler,
  addGroupMember,
  createGroupWithMembers,
  listGroupInvitesForUser,
  listGroupsForUser,
  removeGroupMember,
  searchUsersByEmail,
  deleteGroup,
  listGroupMembers,
  ensureUserInTrip,
  removeGroupInvite,
  acceptGroupInvite,
} from '../db';
import { isEmailConfigured, sendShareEmail } from '../mailer';

// Account management (profile, password, deletion) for authenticated web users.
const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const profile = await getWebUserProfile(userId);
  if (!profile) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(profile);
});

router.patch('/profile', async (req, res) => {
  const user = (req as any).user as { userId: string; email: string };
  const { firstName, lastName, email } = req.body ?? {};
  if (!firstName && !lastName && !email) {
    res.status(400).json({ error: 'At least one field is required' });
    return;
  }
  try {
    const updated = await updateWebUserProfile(user.userId, {
      firstName: typeof firstName === 'string' ? firstName.trim() : undefined,
      lastName: typeof lastName === 'string' ? lastName.trim() : undefined,
      email: typeof email === 'string' ? email.trim().toLowerCase() : undefined,
    });
    const token = createToken({ userId: updated.id, email: updated.email, provider: 'email' });
    res.json({ user: updated, token });
  } catch (err: any) {
    if (err?.code === 'EMAIL_TAKEN') {
      res.status(409).json({ error: 'Email already in use' });
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  }
});

router.patch('/password', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { currentPassword, newPassword, newPasswordConfirm } = req.body ?? {};
  if (!currentPassword || !newPassword || !newPasswordConfirm) {
    res.status(400).json({ error: 'currentPassword, newPassword, and newPasswordConfirm are required' });
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
    await updateWebUserPassword(userId, currentPassword, newPassword);
    res.json({ message: 'Password updated' });
  } catch (err: any) {
    if (err?.code === 'INVALID_PASSWORD') {
      res.status(401).json({ error: 'Current password is incorrect' });
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
  const { firstName, lastName } = req.body ?? {};
  try {
    await createFellowTraveler(userId, String(firstName ?? ''), String(lastName ?? ''));
    const travelers = await listFellowTravelers(userId);
    res.status(201).json(travelers);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/fellow-travelers/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { firstName, lastName } = req.body ?? {};
  try {
    await updateFellowTraveler(userId, req.params.id, String(firstName ?? ''), String(lastName ?? ''));
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
        for (const m of membershipsToUpdate.rows as Array<{ id: string; group_id: string; user_id: string | null; added_by: string | null }>) {
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
  const membership = await ensureUserInTrip(req.params.tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'Not authorized to add members to this trip' });
    return;
  }
  const { email, guestName } = req.body as { email?: string; guestName?: string };
  try {
    const result = await addGroupMember(userId, membership.groupId, { email, guestName });
    res.status(201).json(result);
  } catch (err) {
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
  const invites = await listGroupInvitesForUser(user.userId, user.email);
  res.json(invites);
});

groupsRouter.post('/invites/:id/accept', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await acceptGroupInvite(req.params.id, userId);
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

    if (isEmailConfigured()) {
      await Promise.all(
        invites.map(({ email }) => {
          const subject = `${user.email} invited you to a group: ${name}`;
          const body = [
            `Hi,`,
            ``,
            `${user.email} invited you to join the group "${name}".`,
            `Log in to Shared Trip Planner to accept this invitation.`,
          ].join('\n');
          return sendShareEmail(email, subject, body).catch(() => undefined);
        })
      );
    }

    res.status(201).json({ id: groupId, invites });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

groupsRouter.post('/:id/members', async (req, res) => {
  const user = (req as any).user as { userId: string; email: string };
  const { email, guestName, firstName, lastName } = req.body as { email?: string; guestName?: string; firstName?: string; lastName?: string };
  const given = typeof firstName === 'string' ? firstName.trim() : '';
  const family = typeof lastName === 'string' ? lastName.trim() : '';
  if ((firstName !== undefined || lastName !== undefined) && (!given || !family)) {
    res.status(400).json({ error: 'firstName and lastName cannot be blank' });
    return;
  }
  const normalizedGuestName = guestName?.trim() || (given && family ? `${given} ${family}` : undefined);
  try {
    const result = await addGroupMember(user.userId, req.params.id, { email, guestName: normalizedGuestName });
    if (result.email && result.inviteId && isEmailConfigured()) {
      const subject = `${user.email} invited you to a group`;
      const body = `${user.email} invited you to join a group. Log in to accept.`;
      await sendShareEmail(result.email, subject, body);
    }
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

groupsRouter.delete('/:groupId/members/:memberId', async (req, res) => {
  const user = (req as any).user as { userId: string };
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
  try {
    const members = await listGroupMembers(req.params.id, user.userId);
    res.json(members);
  } catch (err) {
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

groupsRouter.delete('/:id', async (req, res) => {
  const user = (req as any).user as { userId: string };
  try {
    await deleteGroup(user.userId, req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
