// Phase 4 of docs/trip-blog-social-implementation-plan.md (B2/B11) — the comment thread for a
// day, text note, photo or video. Two levels only (top-level comment + its replies, PRD §6.6's
// mockup), each top-level comment arriving with up to 3 preview replies from the day-level fetch
// and a "Show N earlier comments" expansion for the rest. Followers get a `colors.info` ring
// around their avatar placeholder and a "Following" chip next to their name, so a traveler can
// always tell whether they're talking to the group or to an audience (PRD §6.6).
import React, { useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import BlogCommentComposer from './BlogCommentComposer';
import type { BlogComment, BlogCommentTargetKind } from '../utils/useBlogComments';

const REPORT_REASONS: Array<{ value: 'spam' | 'harassment' | 'private_info' | 'other'; label: string }> = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'private_info', label: 'Private info' },
  { value: 'other', label: 'Other' },
];

const EDIT_WINDOW_MS = 15 * 60 * 1000; // FR-B2.3 — server is the real enforcement; this only hides a button that would 500 past the window.

const formatWhen = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

type CommonProps = {
  currentUserId: string | null;
  canModerate: boolean;
  canEngage: boolean;
  onReply?: (parentCommentId: string, body: string) => Promise<any>;
  onEdit: (commentId: string, body: string) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  onReport: (commentId: string, reason: 'spam' | 'harassment' | 'private_info' | 'other') => Promise<void>;
  onHide: (commentId: string) => Promise<void>;
  onUnhide: (commentId: string) => Promise<void>;
  onError: (message: string) => void;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  backgroundColor: string;
  styles?: any;
  theme?: any;
  testID?: string;
};

const audienceChipLabel = (audience: BlogComment['audience']): string | null => {
  if (audience === 'travelers') return 'Visible to travelers';
  if (audience === 'followers') return 'Visible to followers';
  return null;
};

const CommentRow: React.FC<CommonProps & { comment: BlogComment; isReply: boolean }> = ({
  comment, isReply, currentUserId, canModerate, canEngage,
  onReply, onEdit, onDelete, onReport, onHide, onUnhide, onError,
  textColor, mutedColor, borderColor, backgroundColor, styles, theme, testID,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);

  const isOwn = Boolean(currentUserId) && comment.authorUserId === currentUserId;
  const isTombstone = Boolean(comment.deletedAt);
  const isHidden = Boolean(comment.hiddenAt);
  const isFollower = comment.authorRole === 'follower';
  const canEditNow = isOwn && !isTombstone && !isHidden && (Date.now() - Date.parse(comment.createdAt)) <= EDIT_WINDOW_MS;
  const audienceLabel = audienceChipLabel(comment.audience);
  const displayName = comment.authorDisplayName ?? (comment.authorUserId ? 'A traveler' : null) ?? 'Deleted account';

  const run = async (action: () => Promise<any>) => {
    setBusy(true);
    try {
      await action();
    } catch (error: any) {
      onError(error?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      testID={testID}
      style={{ marginLeft: isReply ? 20 : 0, borderLeftWidth: isReply ? 2 : 0, borderLeftColor: borderColor, paddingLeft: isReply ? 8 : 0, marginTop: isReply ? 8 : 12 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <View
          testID={testID ? `${testID}-avatar` : undefined}
          style={{
            width: 22, height: 22, borderRadius: 11, backgroundColor: mutedColor,
            borderWidth: isFollower ? 2 : 0, borderColor: isFollower ? (theme?.colors?.info ?? '#0369a1') : 'transparent',
            marginTop: 2,
          }}
        />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text style={{ color: textColor, fontWeight: '700' }}>{displayName}</Text>
            {isFollower ? (
              <View style={{ backgroundColor: theme?.colors?.surfaceMuted ?? '#e0f2fe', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: theme?.colors?.info ?? '#0369a1' }}>Following</Text>
              </View>
            ) : null}
            {audienceLabel ? (
              <Text testID={testID ? `${testID}-audience-chip` : undefined} style={{ fontSize: 10, fontWeight: '600', color: mutedColor }}>
                {audienceLabel}
              </Text>
            ) : null}
            {isHidden && canModerate ? (
              <Text style={{ fontSize: 10, fontWeight: '700', color: theme?.colors?.error ?? '#b91c1c' }}>Hidden</Text>
            ) : null}
            {!menuOpen && canEngage && !isTombstone ? (
              <TouchableOpacity
                testID={testID ? `${testID}-menu` : undefined}
                accessibilityRole="button"
                accessibilityLabel="Comment options"
                hitSlop={8}
                onPress={() => setMenuOpen(true)}
                style={{ marginLeft: 'auto' }}
              >
                <Text style={{ color: mutedColor, fontWeight: '700' }}>⋯</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {editing ? (
            <View style={{ marginTop: 4 }}>
              <BlogCommentComposer
                testID={testID ? `${testID}-edit` : undefined}
                placeholder="Edit your comment…"
                submitLabel="Save"
                autoFocus
                onCancel={() => setEditing(false)}
                onSubmit={async (body) => {
                  await run(async () => { await onEdit(comment.id, body); setEditing(false); });
                }}
                textColor={textColor}
                mutedColor={mutedColor}
                borderColor={borderColor}
                backgroundColor={backgroundColor}
                styles={styles}
              />
            </View>
          ) : (
            <Text style={{ color: isTombstone ? mutedColor : textColor, fontStyle: isTombstone ? 'italic' : 'normal', marginTop: 2 }}>
              {isTombstone ? 'This comment was deleted.' : (comment.body ?? '')}
            </Text>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <Text style={{ color: mutedColor, fontSize: 11 }}>
              {formatWhen(comment.createdAt)}{comment.editedAt ? '  (edited)' : ''}
            </Text>
            {!isReply && !isTombstone && canEngage && onReply ? (
              <TouchableOpacity testID={testID ? `${testID}-reply-toggle` : undefined} accessibilityRole="button" onPress={() => setReplying((v) => !v)}>
                <Text style={{ color: mutedColor, fontWeight: '700', fontSize: 11 }}>Reply</Text>
              </TouchableOpacity>
            ) : null}
            {busy ? <ActivityIndicator size="small" color={mutedColor} /> : null}
          </View>

          {menuOpen ? (
            <View testID={testID ? `${testID}-menu-open` : undefined} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
              {canEditNow ? (
                <TouchableOpacity testID={testID ? `${testID}-edit-action` : undefined} accessibilityRole="button" onPress={() => { setEditing(true); setMenuOpen(false); }}>
                  <Text style={{ color: mutedColor, fontWeight: '600', fontSize: 12 }}>Edit</Text>
                </TouchableOpacity>
              ) : null}
              {isOwn && !isTombstone ? (
                <TouchableOpacity
                  testID={testID ? `${testID}-delete-action` : undefined}
                  accessibilityRole="button"
                  onPress={() => run(async () => { await onDelete(comment.id); setMenuOpen(false); })}
                >
                  <Text style={{ color: theme?.colors?.error ?? '#b91c1c', fontWeight: '600', fontSize: 12 }}>Delete</Text>
                </TouchableOpacity>
              ) : null}
              {!isOwn && !isTombstone ? (
                <TouchableOpacity testID={testID ? `${testID}-report-action` : undefined} accessibilityRole="button" onPress={() => setReporting((v) => !v)}>
                  <Text style={{ color: mutedColor, fontWeight: '600', fontSize: 12 }}>Report</Text>
                </TouchableOpacity>
              ) : null}
              {canModerate && !isTombstone && !isHidden ? (
                <TouchableOpacity
                  testID={testID ? `${testID}-hide-action` : undefined}
                  accessibilityRole="button"
                  onPress={() => run(async () => { await onHide(comment.id); setMenuOpen(false); })}
                >
                  <Text style={{ color: theme?.colors?.error ?? '#b91c1c', fontWeight: '600', fontSize: 12 }}>Hide</Text>
                </TouchableOpacity>
              ) : null}
              {canModerate && isHidden ? (
                <TouchableOpacity
                  testID={testID ? `${testID}-unhide-action` : undefined}
                  accessibilityRole="button"
                  onPress={() => run(async () => { await onUnhide(comment.id); setMenuOpen(false); })}
                >
                  <Text style={{ color: mutedColor, fontWeight: '600', fontSize: 12 }}>Unhide</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity testID={testID ? `${testID}-menu-close` : undefined} accessibilityRole="button" onPress={() => { setMenuOpen(false); setReporting(false); }}>
                <Text style={{ color: mutedColor, fontSize: 12 }}>Close</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {reporting ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {REPORT_REASONS.map((reason) => (
                <TouchableOpacity
                  key={reason.value}
                  testID={testID ? `${testID}-report-${reason.value}` : undefined}
                  accessibilityRole="button"
                  onPress={() => run(async () => { await onReport(comment.id, reason.value); setReporting(false); setMenuOpen(false); })}
                  style={{ borderWidth: 1, borderColor, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}
                >
                  <Text style={{ color: textColor, fontSize: 11 }}>{reason.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          {replying && onReply ? (
            <View style={{ marginTop: 6 }}>
              <BlogCommentComposer
                testID={testID ? `${testID}-reply` : undefined}
                placeholder={`Reply to ${displayName}…`}
                submitLabel="Reply"
                autoFocus
                onCancel={() => setReplying(false)}
                onSubmit={async (body) => {
                  await run(async () => { await onReply(comment.id, body); setReplying(false); });
                }}
                textColor={textColor}
                mutedColor={mutedColor}
                borderColor={borderColor}
                backgroundColor={backgroundColor}
                styles={styles}
              />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
};

type ThreadProps = Omit<CommonProps, 'onReply'> & {
  comments: BlogComment[];
  targetKind: BlogCommentTargetKind;
  targetId: string;
  audienceLabel?: string | null;
  onPostTopLevel: (body: string) => Promise<any>;
  onReply: (parentCommentId: string, body: string) => Promise<any>;
  onShowEarlierReplies?: (commentId: string) => Promise<void>;
};

const BlogCommentThread: React.FC<ThreadProps> = ({
  comments, audienceLabel, onPostTopLevel, onReply, onShowEarlierReplies,
  currentUserId, canModerate, canEngage, onEdit, onDelete, onReport, onHide, onUnhide, onError,
  textColor, mutedColor, borderColor, backgroundColor, styles, theme, testID,
}) => {
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});

  const commonRowProps = { currentUserId, canModerate, canEngage, onEdit, onDelete, onReport, onHide, onUnhide, onError, textColor, mutedColor, borderColor, backgroundColor, styles, theme };

  return (
    <View testID={testID}>
      {comments.length === 0 ? (
        <Text style={{ color: mutedColor, fontSize: 12, marginBottom: 8 }}>No comments yet.</Text>
      ) : null}
      {comments.map((comment) => {
        const previewReplies = comment.replies ?? [];
        const hasMoreReplies = comment.replyCount > previewReplies.length;
        const showingAll = expandedReplies[comment.id];
        return (
          <View key={comment.id}>
            <CommentRow
              {...commonRowProps}
              comment={comment}
              isReply={false}
              onReply={onReply}
              testID={testID ? `${testID}-comment-${comment.id}` : undefined}
            />
            {previewReplies.map((reply) => (
              <CommentRow
                key={reply.id}
                {...commonRowProps}
                comment={reply}
                isReply
                testID={testID ? `${testID}-comment-${reply.id}` : undefined}
              />
            ))}
            {hasMoreReplies && !showingAll ? (
              <TouchableOpacity
                testID={testID ? `${testID}-show-earlier-${comment.id}` : undefined}
                accessibilityRole="button"
                style={{ marginLeft: 20, marginTop: 2 }}
                onPress={async () => {
                  setExpandedReplies((current) => ({ ...current, [comment.id]: true }));
                  try {
                    await onShowEarlierReplies?.(comment.id);
                  } catch (error: any) {
                    onError(error?.message || 'Unable to load earlier comments');
                  }
                }}
              >
                <Text style={{ color: mutedColor, fontWeight: '600', fontSize: 12 }}>
                  ▾ Show {comment.replyCount - previewReplies.length} earlier {comment.replyCount - previewReplies.length === 1 ? 'comment' : 'comments'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })}
      {canEngage ? (
        <View style={{ marginTop: 12 }}>
          <BlogCommentComposer
            testID={testID ? `${testID}-composer` : undefined}
            placeholder="Write a comment…"
            audienceLabel={audienceLabel}
            onSubmit={async (body) => {
              try {
                await onPostTopLevel(body);
              } catch (error: any) {
                onError(error?.message || 'Unable to post your comment');
                throw error;
              }
            }}
            textColor={textColor}
            mutedColor={mutedColor}
            borderColor={borderColor}
            backgroundColor={backgroundColor}
            styles={styles}
          />
        </View>
      ) : null}
    </View>
  );
};

export default BlogCommentThread;
