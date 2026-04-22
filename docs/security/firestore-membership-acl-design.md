# Firestore Membership / ACL Design

## Goal

Make group and trip access checkable in Firestore Security Rules without relying on collection queries.

Today, membership is stored primarily in random-ID documents like:

- `group_members/{randomUuid}`
- `group_invites/{randomUuid}`
- `trip_followers/{randomUuid}`
- `trip_removals/{randomUuid}`

That works for server code, but it does not work well for rules because rules can only do deterministic `get()` / `exists()` lookups. They cannot ask Firestore:

- "find any membership doc for this `groupId` + `userId`"
- "find any removal doc for this `tripId` + `userId`"
- "find any follower doc for this `tripId` + `userId`"

As a result, direct client reads cannot safely support real member-level access without either:

1. keeping the current blanket allow rule, or
2. failing closed for everyone except owners.

This design fixes that by adding deterministic ACL projection documents.

## Design Principles

- Rules must be able to prove access with `exists()` or `get()` on a known path.
- The server remains the source of truth for mutations.
- Client writes should stay denied by default unless there is a deliberate future reason to allow them.
- ACL projection docs may be derived data as long as they are updated transactionally or near-transactionally with the authoritative records.
- We should optimize for read authorization, not for preserving every current collection shape unchanged.

## Recommended Model

Use deterministic per-user ACL documents for groups and trips.

### Group access projection

New collection:

- `group_access/{groupId_userId}`

Document id:

- `${groupId}_${userId}`

Shape:

```json
{
  "groupId": "group-123",
  "userId": "user-456",
  "role": "owner",
  "status": "active",
  "canRead": true,
  "canWrite": true,
  "canManageMembers": true,
  "source": "group_member",
  "createdAt": "2026-04-22T00:00:00.000Z",
  "updatedAt": "2026-04-22T00:00:00.000Z"
}
```

Roles:

- `owner`
- `member`

Status:

- `active`
- `removed`

Semantics:

- exactly one current group access doc per `(groupId, userId)`
- owner doc is always present for `groups.ownerId`
- `removed` may be kept for audit/debug, but rules should only treat `active` as access-granting

### Group invite projection

New collection:

- `group_invite_access/{groupId_emailKey}`

Document id:

- `${groupId}_${emailKey}`

Where `emailKey` is a normalized deterministic key. Recommended:

- lowercase normalized email with a stable hash, for example `sha256(normalizedEmail)`

Shape:

```json
{
  "groupId": "group-123",
  "inviteeEmailHash": "abc123...",
  "inviteeEmailNormalized": "member@example.com",
  "inviteeUserId": "user-456",
  "status": "pending",
  "tripId": "trip-789",
  "createdAt": "2026-04-22T00:00:00.000Z",
  "updatedAt": "2026-04-22T00:00:00.000Z"
}
```

Important note:

- rules can only compare against `request.auth.token.email` if that claim is present
- email-hash invite checks are useful for read access to "your pending invites" style UI
- they should not be the primary long-term authorization mechanism for durable trip data

### Trip access projection

New collection:

- `trip_access/{tripId_userId}`

Document id:

- `${tripId}_${userId}`

Shape:

```json
{
  "tripId": "trip-789",
  "groupId": "group-123",
  "userId": "user-456",
  "role": "member",
  "status": "active",
  "canRead": true,
  "canWrite": true,
  "canComment": true,
  "canVote": true,
  "source": "group_membership",
  "createdAt": "2026-04-22T00:00:00.000Z",
  "updatedAt": "2026-04-22T00:00:00.000Z"
}
```

Supported roles:

- `owner`
- `member`
- `follower`

Supported statuses:

- `active`
- `removed`
- `revoked`

Semantics:

- `owner` and `member` have `canWrite: true`
- `follower` has `canRead: true`, `canWrite: false`
- if a user is removed from a trip, the projection doc must become non-granting immediately
- if a user follows a trip, the follower projection is the thing rules check

This collection becomes the main proof object for all trip-scoped reads in rules.

## Why Trip-Level ACL Projection Is Better Than Group-Only Checks

A pure group-membership design is not enough because this app also has:

- trip removals
- trip followers
- trip-specific read-only access

If rules only ask "is this user in the group?", then they cannot correctly express:

- member is in group but removed from one trip
- user is not a group member but is an allowed follower for a trip

Trip-level ACL projections solve that cleanly.

## Recommended Collection Layout

Keep the current business collections, but authorize them through deterministic ACL docs.

### Authoritative data

- `groups/{groupId}`
- `group_members/{randomUuid}` or later `groups/{groupId}/members/{userId}`
- `group_invites/{randomUuid}` or later `groups/{groupId}/invites/{inviteKey}`
- `trips/{tripId}`
- `trip_followers/{randomUuid}`
- `trip_removals/{randomUuid}`

### New rule-friendly projections

- `group_access/{groupId_userId}`
- `group_invite_access/{groupId_emailHash}`
- `trip_access/{tripId_userId}`

## Rules Shape

With the new projection docs, rules become simple and deterministic.

```text
function tripAccessDocId(tripId) {
  return tripId + "_" + request.auth.uid;
}

function canReadTrip(tripId) {
  return request.auth != null
    && exists(/databases/$(database)/documents/trip_access/$(tripAccessDocId(tripId)))
    && get(/databases/$(database)/documents/trip_access/$(tripAccessDocId(tripId))).data.canRead == true
    && get(/databases/$(database)/documents/trip_access/$(tripAccessDocId(tripId))).data.status == "active";
}

function canWriteTrip(tripId) {
  return request.auth != null
    && exists(/databases/$(database)/documents/trip_access/$(tripAccessDocId(tripId)))
    && get(/databases/$(database)/documents/trip_access/$(tripAccessDocId(tripId))).data.canWrite == true
    && get(/databases/$(database)/documents/trip_access/$(tripAccessDocId(tripId))).data.status == "active";
}
```

Then trip-scoped collections become straightforward:

- `trips/{tripId}`: read if `canReadTrip(tripId)`
- `flights/{flightId}`: read if `canReadTrip(resource.data.tripId)`
- `lodgings/{lodgingId}`: read if `canReadTrip(resource.data.tripId or resource.data.trip_id)`
- `trip_messages/{messageId}`: read if `canReadTrip(resource.data.tripId)`
- writes remain denied unless there is a deliberate direct-client use case

## Schema Normalization Recommendation

The projection docs above are enough to make rules work. But longer-term, the base schema should also move toward deterministic entity paths.

### Recommended future layout

- `groups/{groupId}/members/{userId}`
- `groups/{groupId}/pending_invites/{emailHash}`
- `trips/{tripId}/followers/{userId}`
- `trips/{tripId}/removed_users/{userId}`

Advantages:

- simpler writes
- easier human debugging
- less duplicated join logic
- easier rules if we ever want to use nested paths directly

However, this is a larger migration. The shortest safe path is:

1. keep current authoritative collections for now
2. add flat projection docs for rules
3. later migrate authoritative records to deterministic nested paths if desired

## ACL Semantics By Actor

### Group owner

- `group_access.role = owner`
- `group_access.canManageMembers = true`
- `trip_access.role = owner` for all trips in the group
- `trip_access.canWrite = true`

### Group member

- `group_access.role = member`
- `group_access.canManageMembers = false`
- `trip_access.role = member` for trips they can participate in
- `trip_access.canWrite = true`

### Trip follower

- no active `group_access` required
- `trip_access.role = follower`
- `trip_access.canRead = true`
- `trip_access.canWrite = false`

### Removed user

- `trip_access.status = removed` or document deleted
- rules must treat both as no access

### Pending invitee

- optional read access only to invite-related collections
- should not receive trip-scoped read access until invite is accepted

## Projection Update Rules

The server must maintain these invariants:

### On group creation

- create `group_access/{groupId_ownerId}` as active owner

### On member add

- create or upsert `group_access/{groupId_userId}`
- upsert `trip_access/{tripId_userId}` for existing trips in that group

### On member remove

- mark `group_access/{groupId_userId}` removed or delete it
- mark all `trip_access/{tripId_userId}` for trips in that group removed unless another direct grant still applies

### On trip creation

- create `trip_access/{tripId_userId}` for every active group member
- owner gets `role=owner`
- other members get `role=member`

### On trip follower add

- create or upsert `trip_access/{tripId_userId}` with `role=follower`, `canWrite=false`

### On trip follower remove

- remove follower grant if no stronger trip grant exists

### On trip removal

- mark or delete `trip_access/{tripId_userId}` for that trip

### On invite accepted

- remove pending invite projection
- create active group/trip access docs as appropriate

## Recommended Write Strategy

Use a projection-writer helper in the server adapter layer.

New helper responsibilities:

- `upsertGroupAccess(groupId, userId, fields)`
- `removeGroupAccess(groupId, userId)`
- `upsertTripAccess(tripId, userId, fields)`
- `removeTripAccess(tripId, userId)`
- `rebuildTripAccessForTrip(tripId)`
- `rebuildGroupAccessForGroup(groupId)`

This keeps ACL projection logic out of route handlers and makes it testable.

## Migration Plan

### Phase 1: Add projection docs without changing client behavior

- introduce `group_access`, `group_invite_access`, `trip_access`
- update server writes so new changes keep projections in sync
- add repair scripts:
  - rebuild ACL for one group
  - rebuild ACL for one trip
  - full backfill

### Phase 2: Backfill existing data

For every group:

- derive owner and active members
- write `group_access`

For every trip:

- derive active group members
- subtract `trip_removals`
- add `trip_followers`
- write `trip_access`

### Phase 3: Switch rules to projection docs

- update `firestore.rules` to use `trip_access` and `group_access`
- add emulator coverage for:
  - owner read
  - member read
  - follower read-only
  - removed user denied
  - outsider denied

### Phase 4: Optional authoritative schema cleanup

- migrate `group_members`, `group_invites`, `trip_followers`, `trip_removals` to deterministic nested documents if still worthwhile

## Example Rules After Migration

```text
match /trips/{tripId} {
  allow read: if canReadTrip(tripId);
  allow write: if false;
}

match /flights/{flightId} {
  allow read: if canReadTrip(resource.data.tripId);
  allow write: if false;
}

match /trip_messages/{messageId} {
  allow read: if canReadTrip(resource.data.tripId);
  allow create, update, delete: if false;
}

match /group_members/{memberDocId} {
  allow read: if canReadGroup(resource.data.groupId);
  allow write: if false;
}
```

## Why Not Use Custom Claims Only

Custom claims are not a good primary fit here because:

- trip membership changes frequently
- claims are coarse-grained and token-refresh dependent
- large trip/group lists will exceed practical claim size
- removals need to take effect quickly

Claims may still be useful for:

- coarse admin capability
- environment-wide privileged roles

But they should not be the main representation of trip membership.

## Why Not Put Member IDs Directly On The Trip Document

A trip document could theoretically contain:

- `memberIds`
- `followerIds`
- `removedUserIds`

This is not recommended as the primary ACL source because:

- the arrays can grow
- updates become hot-spot writes on the trip doc
- concurrent membership changes become more fragile
- rules become noisier when multiple ACL dimensions live in one doc

Per-user projection docs scale better and are easier to reason about.

## Recommended Next Implementation Slice

The safest next code change after this design is:

1. add `trip_access` projection docs
2. backfill them from existing groups, members, removals, and followers
3. switch trip-scoped rules from owner-only checks to `trip_access`
4. add emulator tests for owner/member/follower/removed access

That is the minimum change set that unlocks real member-level rule enforcement.
