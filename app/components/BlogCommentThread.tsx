import { resolveComponentTheme as resolveStyleTheme, themeStyle, avatarColor as colorForUser } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
// Phase 4 of docs/trip-blog-social-implementation-plan.md (B2/B11) — the comment thread for a
// day, text note, photo or video. Two levels only (top-level comment + its replies, PRD §6.6's
// mockup), each top-level comment arriving with up to 3 preview replies from the day-level fetch
// and a "Show N earlier comments" expansion for the rest. Followers get a `colors.info` ring
// around their avatar placeholder and a "Following" chip next to their name, so a traveler can
// always tell whether they're talking to the group or to an audience (PRD §6.6).
import React, { useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import BlogCommentComposer from './BlogCommentComposer';
import { initialsForName } from '../../packages/messaging/src/colors';

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
  textColor, mutedColor, borderColor, backgroundColor, styles, theme: _providedTheme, testID,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
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
      style={themeStyle('components_BlogCommentThread_1', { isReply: isReply, borderColor: borderColor }, (theme ?? _styleTheme))}
    >
      <View style={themeStyle('components_BlogCommentThread_2', {  }, (theme ?? _styleTheme))}>
        <View
          testID={testID ? `${testID}-avatar` : undefined}
          style={themeStyle('components_BlogCommentThread_3', { comment: comment, colorForUser: colorForUser, mutedColor: mutedColor, isFollower: isFollower, theme: theme }, (theme ?? _styleTheme))}
        >
          {comment.authorUserId ? (
            <Text style={themeStyle('components_BlogCommentThread_4', {  }, (theme ?? _styleTheme))}>{initialsForName(displayName)}</Text>
          ) : null}
        </View>
        <View style={themeStyle('components_BlogCommentThread_5', {  }, (theme ?? _styleTheme))}>
          <View style={themeStyle('components_BlogCommentThread_6', {  }, (theme ?? _styleTheme))}>
            <Text style={themeStyle('components_BlogCommentThread_7', { textColor: textColor }, (theme ?? _styleTheme))}>{displayName}</Text>
            {isFollower ? (
              <View style={themeStyle('components_BlogCommentThread_8', { theme: theme }, (theme ?? _styleTheme))}>
                <Text style={themeStyle('components_BlogCommentThread_9', { theme: theme }, (theme ?? _styleTheme))}>Following</Text>
              </View>
            ) : null}
            {audienceLabel ? (
              <Text testID={testID ? `${testID}-audience-chip` : undefined} style={themeStyle('components_BlogCommentThread_10', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>
                {audienceLabel}
              </Text>
            ) : null}
            {isHidden && canModerate ? (
              <Text style={themeStyle('components_BlogCommentThread_11', { theme: theme }, (theme ?? _styleTheme))}>Hidden</Text>
            ) : null}
            {!menuOpen && canEngage && !isTombstone ? (
              <TouchableOpacity
                testID={testID ? `${testID}-menu` : undefined}
                accessibilityRole="button"
                accessibilityLabel="Comment options"
                hitSlop={8}
                onPress={() => setMenuOpen(true)}
                style={themeStyle('components_BlogCommentThread_12', {  }, (theme ?? _styleTheme))}
              >
                <Text style={themeStyle('components_BlogCommentThread_13', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>⋯</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {editing ? (
            <View style={themeStyle('components_BlogCommentThread_14', {  }, (theme ?? _styleTheme))}>
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
            <Text style={themeStyle('components_BlogCommentThread_15', { isTombstone: isTombstone, mutedColor: mutedColor, textColor: textColor }, (theme ?? _styleTheme))}>
              {isTombstone ? 'This comment was deleted.' : (comment.body ?? '')}
            </Text>
          )}

          <View style={themeStyle('components_BlogCommentThread_16', {  }, (theme ?? _styleTheme))}>
            <Text style={themeStyle('components_BlogCommentThread_17', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>
              {formatWhen(comment.createdAt)}{comment.editedAt ? '  (edited)' : ''}
            </Text>
            {!isReply && !isTombstone && canEngage && onReply ? (
              <TouchableOpacity testID={testID ? `${testID}-reply-toggle` : undefined} accessibilityRole="button" onPress={() => setReplying((v) => !v)}>
                <Text style={themeStyle('components_BlogCommentThread_18', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>Reply</Text>
              </TouchableOpacity>
            ) : null}
            {busy ? <ActivityIndicator size="small" color={mutedColor} /> : null}
          </View>

          {menuOpen ? (
            <View testID={testID ? `${testID}-menu-open` : undefined} style={themeStyle('components_BlogCommentThread_19', {  }, (theme ?? _styleTheme))}>
              {canEditNow ? (
                <TouchableOpacity testID={testID ? `${testID}-edit-action` : undefined} accessibilityRole="button" onPress={() => { setEditing(true); setMenuOpen(false); }}>
                  <Text style={themeStyle('components_BlogCommentThread_20', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>Edit</Text>
                </TouchableOpacity>
              ) : null}
              {isOwn && !isTombstone ? (
                <TouchableOpacity
                  testID={testID ? `${testID}-delete-action` : undefined}
                  accessibilityRole="button"
                  onPress={() => run(async () => { await onDelete(comment.id); setMenuOpen(false); })}
                >
                  <Text style={themeStyle('components_BlogCommentThread_21', { theme: theme }, (theme ?? _styleTheme))}>Delete</Text>
                </TouchableOpacity>
              ) : null}
              {!isOwn && !isTombstone ? (
                <TouchableOpacity testID={testID ? `${testID}-report-action` : undefined} accessibilityRole="button" onPress={() => setReporting((v) => !v)}>
                  <Text style={themeStyle('components_BlogCommentThread_22', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>Report</Text>
                </TouchableOpacity>
              ) : null}
              {canModerate && !isTombstone && !isHidden ? (
                <TouchableOpacity
                  testID={testID ? `${testID}-hide-action` : undefined}
                  accessibilityRole="button"
                  onPress={() => run(async () => { await onHide(comment.id); setMenuOpen(false); })}
                >
                  <Text style={themeStyle('components_BlogCommentThread_23', { theme: theme }, (theme ?? _styleTheme))}>Hide</Text>
                </TouchableOpacity>
              ) : null}
              {canModerate && isHidden ? (
                <TouchableOpacity
                  testID={testID ? `${testID}-unhide-action` : undefined}
                  accessibilityRole="button"
                  onPress={() => run(async () => { await onUnhide(comment.id); setMenuOpen(false); })}
                >
                  <Text style={themeStyle('components_BlogCommentThread_24', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>Unhide</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity testID={testID ? `${testID}-menu-close` : undefined} accessibilityRole="button" onPress={() => { setMenuOpen(false); setReporting(false); }}>
                <Text style={themeStyle('components_BlogCommentThread_25', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>Close</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {reporting ? (
            <View style={themeStyle('components_BlogCommentThread_26', {  }, (theme ?? _styleTheme))}>
              {REPORT_REASONS.map((reason) => (
                <TouchableOpacity
                  key={reason.value}
                  testID={testID ? `${testID}-report-${reason.value}` : undefined}
                  accessibilityRole="button"
                  onPress={() => run(async () => { await onReport(comment.id, reason.value); setReporting(false); setMenuOpen(false); })}
                  style={themeStyle('components_BlogCommentThread_27', { borderColor: borderColor }, (theme ?? _styleTheme))}
                >
                  <Text style={themeStyle('components_BlogCommentThread_28', { textColor: textColor }, (theme ?? _styleTheme))}>{reason.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          {replying && onReply ? (
            <View style={themeStyle('components_BlogCommentThread_29', {  }, (theme ?? _styleTheme))}>
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
  textColor, mutedColor, borderColor, backgroundColor, styles, theme: _providedTheme, testID,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});

  const commonRowProps = themeStyle('components_BlogCommentThread_30', { currentUserId: currentUserId, canModerate: canModerate, canEngage: canEngage, onEdit: onEdit, onDelete: onDelete, onReport: onReport, onHide: onHide, onUnhide: onUnhide, onError: onError, textColor: textColor, mutedColor: mutedColor, borderColor: borderColor, backgroundColor: backgroundColor, styles: styles, theme: theme }, (theme ?? _styleTheme));

  return (
    <View testID={testID}>
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
                style={themeStyle('components_BlogCommentThread_31', {  }, (theme ?? _styleTheme))}
                onPress={async () => {
                  setExpandedReplies((current) => ({ ...current, [comment.id]: true }));
                  try {
                    await onShowEarlierReplies?.(comment.id);
                  } catch (error: any) {
                    onError(error?.message || 'Unable to load earlier comments');
                  }
                }}
              >
                <Text style={themeStyle('components_BlogCommentThread_32', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>
                  ▾ Show {comment.replyCount - previewReplies.length} earlier {comment.replyCount - previewReplies.length === 1 ? 'comment' : 'comments'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })}
      {canEngage ? (
        <View style={themeStyle('components_BlogCommentThread_33', {  }, (theme ?? _styleTheme))}>
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
