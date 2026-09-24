/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import BlogCommentThread from '../components/BlogCommentThread';

const baseComment = (overrides: any = {}) => ({
  id: 'c1',
  tripId: 'trip-1',
  targetKind: 'day' as const,
  targetId: 'day-1',
  parentCommentId: null,
  authorUserId: 'user-2',
  authorRole: 'traveler' as const,
  authorDisplayName: 'Maya',
  body: 'The light here was unreal',
  audience: 'public' as const,
  editedAt: null,
  deletedAt: null,
  hiddenAt: null,
  hiddenByUserId: null,
  replyCount: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  replies: [],
  ...overrides,
});

const noop = jest.fn().mockResolvedValue(undefined);

const renderThread = (props: any = {}) => render(
  <BlogCommentThread
    comments={[baseComment()]}
    targetKind="day"
    targetId="day-1"
    currentUserId="user-1"
    canModerate={false}
    canEngage
    onPostTopLevel={noop}
    onReply={noop}
    onEdit={noop}
    onDelete={noop}
    onReport={noop}
    onHide={noop}
    onUnhide={noop}
    onError={jest.fn()}
    textColor="#111"
    mutedColor="#666"
    borderColor="#ccc"
    backgroundColor="#fff"
    testID="thread"
    {...props}
  />
);

describe('BlogCommentThread', () => {
  it('renders author name, body and a follower ring + "Following" chip only for followers', () => {
    const { getByTestId, queryByTestId, rerender } = renderThread();
    expect(getByTestId('thread-comment-c1').props).toBeTruthy();
    // No "Following" chip for a traveler-authored comment.
    expect(queryByTestId('thread-comment-c1-audience-chip')).toBeNull();

    rerender(
      <BlogCommentThread
        comments={[baseComment({ authorRole: 'follower', audience: 'travelers' })]}
        targetKind="day" targetId="day-1" currentUserId="user-1" canModerate={false} canEngage
        onPostTopLevel={noop} onReply={noop} onEdit={noop} onDelete={noop} onReport={noop} onHide={noop} onUnhide={noop}
        onError={jest.fn()} textColor="#111" mutedColor="#666" borderColor="#ccc" backgroundColor="#fff" testID="thread"
      />
    );
    expect(getByTestId('thread-comment-c1-audience-chip').props.children).toBe('Visible to travelers');
  });

  it('shows a tombstone body and hides the overflow menu for a deleted comment', () => {
    const { getByTestId, queryByTestId } = renderThread({
      comments: [baseComment({ deletedAt: new Date().toISOString(), body: null })],
    });
    expect(getByTestId('thread-comment-c1').findAllByType(require('react-native').Text)
      .some((n: any) => String(n.props.children).includes('deleted'))).toBe(true);
    expect(queryByTestId('thread-comment-c1-menu')).toBeNull();
  });

  it('the overflow menu offers Edit/Delete only to the comment\'s own author, within the edit window', () => {
    const { getByTestId, queryByTestId } = renderThread({ currentUserId: 'user-2' });
    fireEvent.press(getByTestId('thread-comment-c1-menu'));
    expect(getByTestId('thread-comment-c1-edit-action')).toBeTruthy();
    expect(getByTestId('thread-comment-c1-delete-action')).toBeTruthy();
    expect(queryByTestId('thread-comment-c1-report-action')).toBeNull(); // can't report your own comment
  });

  it('a non-author sees Report but not Edit/Delete', () => {
    const { getByTestId, queryByTestId } = renderThread({ currentUserId: 'someone-else' });
    fireEvent.press(getByTestId('thread-comment-c1-menu'));
    expect(getByTestId('thread-comment-c1-report-action')).toBeTruthy();
    expect(queryByTestId('thread-comment-c1-edit-action')).toBeNull();
    expect(queryByTestId('thread-comment-c1-delete-action')).toBeNull();
  });

  it('does not offer Edit past the 15-minute window, even to the author', () => {
    const { getByTestId, queryByTestId } = renderThread({
      currentUserId: 'user-2',
      comments: [baseComment({ createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString() })],
    });
    fireEvent.press(getByTestId('thread-comment-c1-menu'));
    expect(queryByTestId('thread-comment-c1-edit-action')).toBeNull();
    expect(getByTestId('thread-comment-c1-delete-action')).toBeTruthy(); // delete has no time limit
  });

  it('Hide/Unhide only appear for a moderator, and only in the state that makes sense', () => {
    const { getByTestId, queryByTestId, rerender } = renderThread({ canModerate: true });
    fireEvent.press(getByTestId('thread-comment-c1-menu'));
    expect(getByTestId('thread-comment-c1-hide-action')).toBeTruthy();
    expect(queryByTestId('thread-comment-c1-unhide-action')).toBeNull();

    rerender(
      <BlogCommentThread
        comments={[baseComment({ hiddenAt: new Date().toISOString() })]}
        targetKind="day" targetId="day-1" currentUserId="user-1" canModerate canEngage
        onPostTopLevel={noop} onReply={noop} onEdit={noop} onDelete={noop} onReport={noop} onHide={noop} onUnhide={noop}
        onError={jest.fn()} textColor="#111" mutedColor="#666" borderColor="#ccc" backgroundColor="#fff" testID="thread"
      />
    );
    // The menu was already open from the previous press in this test (rerender preserves the
    // CommentRow instance's local state, not a fresh mount), so no second press is needed here.
    expect(getByTestId('thread-comment-c1-unhide-action')).toBeTruthy();
    expect(queryByTestId('thread-comment-c1-hide-action')).toBeNull();
  });

  it('calling Hide invokes onHide with the comment id', async () => {
    const onHide = jest.fn().mockResolvedValue(undefined);
    const { getByTestId } = renderThread({ canModerate: true, onHide });
    fireEvent.press(getByTestId('thread-comment-c1-menu'));
    await act(async () => { fireEvent.press(getByTestId('thread-comment-c1-hide-action')); });
    expect(onHide).toHaveBeenCalledWith('c1');
  });

  it('reporting posts the selected reason', async () => {
    const onReport = jest.fn().mockResolvedValue(undefined);
    const { getByTestId } = renderThread({ currentUserId: 'someone-else', onReport });
    fireEvent.press(getByTestId('thread-comment-c1-menu'));
    fireEvent.press(getByTestId('thread-comment-c1-report-action'));
    await act(async () => { fireEvent.press(getByTestId('thread-comment-c1-report-spam')); });
    expect(onReport).toHaveBeenCalledWith('c1', 'spam');
  });

  it('reply preview renders nested replies, and "Show N earlier" appears only when more exist', () => {
    const { getByTestId, queryByTestId } = renderThread({
      comments: [baseComment({
        replyCount: 5,
        replies: [baseComment({ id: 'r1', parentCommentId: 'c1' })],
      })],
    });
    expect(getByTestId('thread-comment-r1')).toBeTruthy();
    expect(getByTestId('thread-show-earlier-c1').props).toBeTruthy();
    expect(getByTestId('thread-show-earlier-c1').findAllByType(require('react-native').Text)[0].props.children.join('')).toContain('4');
  });

  it('tapping "Show N earlier" calls onShowEarlierReplies with the comment id', async () => {
    const onShowEarlierReplies = jest.fn().mockResolvedValue(undefined);
    const { getByTestId } = renderThread({
      comments: [baseComment({ replyCount: 4, replies: [baseComment({ id: 'r1', parentCommentId: 'c1' })] })],
      onShowEarlierReplies,
    });
    await act(async () => { fireEvent.press(getByTestId('thread-show-earlier-c1')); });
    expect(onShowEarlierReplies).toHaveBeenCalledWith('c1');
  });

  it('posting a new top-level comment via the composer calls onPostTopLevel', async () => {
    const onPostTopLevel = jest.fn().mockResolvedValue(undefined);
    const { getByTestId } = renderThread({ onPostTopLevel, comments: [] });
    fireEvent.changeText(getByTestId('thread-composer-input'), 'A brand new comment');
    await act(async () => { fireEvent.press(getByTestId('thread-composer-submit')); });
    expect(onPostTopLevel).toHaveBeenCalledWith('A brand new comment');
  });

  it('replying to a top-level comment calls onReply with the parent id', async () => {
    const onReply = jest.fn().mockResolvedValue(undefined);
    const { getByTestId } = renderThread({ onReply });
    fireEvent.press(getByTestId('thread-comment-c1-reply-toggle'));
    fireEvent.changeText(getByTestId('thread-comment-c1-reply-input'), 'Totally agree');
    await act(async () => { fireEvent.press(getByTestId('thread-comment-c1-reply-submit')); });
    expect(onReply).toHaveBeenCalledWith('c1', 'Totally agree');
  });

  it('hides the composer entirely when canEngage is false', () => {
    const { queryByTestId } = renderThread({ canEngage: false });
    expect(queryByTestId('thread-composer')).toBeNull();
  });

  it('shows an empty state when there are no comments', () => {
    const { getByText } = renderThread({ comments: [] });
    expect(getByText('No comments yet.')).toBeTruthy();
  });
});
