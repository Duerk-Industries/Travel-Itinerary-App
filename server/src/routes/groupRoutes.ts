import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import {
  acceptGroupInvite,
  addGroupMember,
  createGroupWithMembers,
  listGroupInvitesForUser,
  listGroupsForUser,
  removeGroupMember,
  removeGroupInvite,
  searchUsersByEmail,
  deleteGroup,
  listGroupMembers,
} from '../db';
import { isEmailConfigured, sendShareEmail } from '../mailer';

// Groups API: manage groups, members, invites, and sharing.
const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/invites', async (req, res) => {
  const user = (req as any).user as { userId: string; email: string };
  const invites = await listGroupInvitesForUser(user.userId, user.email);
  res.json(invites);
});

router.post('/invites/:id/accept', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await acceptGroupInvite(req.params.id, userId);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/search-users', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) {
    res.json([]);
    return;
  }
  const users = await searchUsersByEmail(q);
  res.json(users);
});

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const sort = String(req.query.sort ?? 'created') === 'name' ? 'name' : 'created';
  const groups = await listGroupsForUser(userId, sort as any);
  res.json(groups);
});

router.post('/', async (req, res) => {
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

router.post('/:id/members', async (req, res) => {
  const user = (req as any).user as { userId: string; email: string };
  const { email, guestName } = req.body as { email?: string; guestName?: string };
  try {
    const result = await addGroupMember(user.userId, req.params.id, { email, guestName });
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

router.delete('/:groupId/members/:memberId', async (req, res) => {
  const user = (req as any).user as { userId: string };
  try {
    await removeGroupMember(user.userId, req.params.groupId, req.params.memberId);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/:id/members', async (req, res) => {
  const user = (req as any).user as { userId: string };
  try {
    const members = await listGroupMembers(req.params.id, user.userId);
    res.json(members);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/invites/:id', async (req, res) => {
  const user = (req as any).user as { userId: string };
  try {
    await removeGroupInvite(user.userId, req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/:id', async (req, res) => {
  const user = (req as any).user as { userId: string };
  try {
    await deleteGroup(user.userId, req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
