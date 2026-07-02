/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import { renderHook } from '@testing-library/react-native';
import { useTripMembers } from '../hooks/useTripMembers';
import type { GroupMemberOption } from '../tabs/transfers';

const mk = (overrides: Partial<GroupMemberOption>): GroupMemberOption => ({
  ...overrides,
  id: `m-${overrides.id ?? Math.random().toString(36).slice(2, 6)}`,
});

describe('useTripMembers', () => {
  it('filters out guest-only members and removed members', () => {
    const members: GroupMemberOption[] = [
      mk({ id: '1', email: 'alice@example.com', status: 'active' }),
      mk({ id: '2', email: 'bob@example.com', status: 'active' }),
      mk({ id: '3', guestName: 'Guest Only', status: 'active' }),
      mk({ id: '4', email: 'charlie@example.com', status: 'removed' }),
    ];
    const { result } = renderHook(() => useTripMembers(members, 'alice@example.com'));
    expect(result.current.userMembers.map((m) => m.id)).toEqual(['m-1', 'm-2']);
    expect(result.current.memberIds).toEqual(['m-1', 'm-2']);
  });

  it('resolves currentUserMemberId case-insensitively from userEmail', () => {
    const members: GroupMemberOption[] = [
      mk({ id: '1', email: 'Alice@Example.com', status: 'active' }),
      mk({ id: '2', email: 'bob@example.com', status: 'active' }),
    ];
    const { result } = renderHook(() => useTripMembers(members, 'ALICE@example.com'));
    expect(result.current.currentUserMemberId).toBe('m-1');
  });

  it('returns null currentUserMemberId when userEmail is missing', () => {
    const members: GroupMemberOption[] = [
      mk({ id: '1', email: 'alice@example.com', status: 'active' }),
    ];
    const { result } = renderHook(() => useTripMembers(members, null));
    expect(result.current.currentUserMemberId).toBeNull();
  });

  it('defaultPayerId prefers the current user, falls back to first user member, else null', () => {
    const membersWithCurrent: GroupMemberOption[] = [
      mk({ id: '1', email: 'other@example.com', status: 'active' }),
      mk({ id: '2', email: 'alice@example.com', status: 'active' }),
    ];
    expect(
      renderHook(() => useTripMembers(membersWithCurrent, 'alice@example.com')).result.current
        .defaultPayerId,
    ).toBe('m-2');

    const membersWithoutCurrent: GroupMemberOption[] = [
      mk({ id: '1', email: 'someone@example.com', status: 'active' }),
      mk({ id: '2', email: 'other@example.com', status: 'active' }),
    ];
    expect(
      renderHook(() => useTripMembers(membersWithoutCurrent, 'missing@example.com')).result.current
        .defaultPayerId,
    ).toBe('m-1');

    expect(renderHook(() => useTripMembers([], 'alice@example.com')).result.current.defaultPayerId).toBeNull();
  });

  it('memoizes — stable references when inputs do not change', () => {
    const members: GroupMemberOption[] = [
      mk({ id: '1', email: 'alice@example.com', status: 'active' }),
    ];
    const { result, rerender } = renderHook(
      (props: { members: GroupMemberOption[]; email: string }) => useTripMembers(props.members, props.email),
      { initialProps: { members, email: 'alice@example.com' } },
    );
    const first = result.current;
    rerender({ members, email: 'alice@example.com' });
    const second = result.current;
    expect(second.userMembers).toBe(first.userMembers);
    expect(second.memberIds).toBe(first.memberIds);
  });
});
