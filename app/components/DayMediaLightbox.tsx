// @ts-nocheck
import { layoutMetrics, resolveComponentTheme as resolveStyleTheme, themeStyle } from '../theme/theme';



import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
// Tiled grid of every photo/video for a day, opened by tapping the DayMediaGallery default view.
// Tapping a photo tile enlarges it inline; tapping a video tile plays it inline (via the same
// platform-conditional BlogMediaPreview branch the default view already uses).
import React, { useState } from 'react';
import { Image, ScrollView, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import DialogShell from './DialogShell';
import { BlogMediaPreview } from './BlogMediaPreview';
import BlogReactionBar from './BlogReactionBar';
import BlogCommentThread from './BlogCommentThread';

type DayMediaLightboxProps = {
  visible: boolean;
  items: any[];
  onClose: () => void;
  dayDate?: string;
  styles?: any;
  textColor?: string;
  mutedColor?: string;
  borderColor?: string;
  backgroundColor?: string;
  // Remove — same contract as DayMediaGallery. The gallery only shows 4 tiles, so for a day with
  // more media this dialog is the only place to delete the rest.
  canRemove?: boolean;
  removing?: boolean;
  onRemove?: (item: any) => void;
  // Phase 3 (B1): same engagement plumbing as DayMediaGallery — a small count badge on every
  // grid tile that has reactions, and the full interactive reaction bar once a tile is expanded.
  canEngage?: boolean;
  canReact?: boolean;
  getEngagementSummary?: (assetId: string) => any;
  onToggleReaction?: (targetKind: 'asset', targetId: string, emoji: string) => Promise<void>;
  onReactionError?: (message: string) => void;
  theme?: any;
  // Phase 4 (B2) — the comment rail (PRD §6.5: "a right rail on wide screens and a bottom sheet
  // on narrow ones"). All of this is optional so a caller that hasn't wired up useBlogComments yet
  // simply gets no rail at all, the same additive-only contract the engagement props above use.
  currentUserId?: string | null;
  canModerate?: boolean;
  audienceLabel?: string | null;
  getComments?: (assetId: string) => any[];
  onPostComment?: (assetId: string, body: string, parentCommentId?: string | null) => Promise<any>;
  onEditComment?: (commentId: string, body: string) => Promise<void>;
  onDeleteComment?: (commentId: string) => Promise<void>;
  onReportComment?: (commentId: string, reason: 'spam' | 'harassment' | 'private_info' | 'other') => Promise<void>;
  onHideComment?: (commentId: string) => Promise<void>;
  onUnhideComment?: (commentId: string) => Promise<void>;
  onShowEarlierReplies?: (commentId: string) => Promise<void>;
  onCommentError?: (message: string) => void;
};

// PRD §6.5's breakpoint is expressed elsewhere in this feature as "mobile (< 700px)" (§6.9) — reused
// here rather than inventing a second breakpoint for the same rail/sheet decision.
const WIDE_LAYOUT_MIN_WIDTH = layoutMetrics.DayMediaLightbox_WIDE_LAYOUT_MIN_WIDTH;

const DayMediaLightbox = ({
  visible, items, onClose, dayDate, styles, textColor, mutedColor, borderColor: _borderColorOverride, backgroundColor,
  canRemove = false, removing = false, onRemove = () => {},
  canEngage = false, canReact = canEngage, getEngagementSummary, onToggleReaction, onReactionError, theme: _providedTheme,
  currentUserId = null, canModerate = false, audienceLabel = null, getComments,
  onPostComment, onEditComment, onDeleteComment, onReportComment, onHideComment, onUnhideComment,
  onShowEarlierReplies, onCommentError,
}: DayMediaLightboxProps) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const borderColor = _borderColorOverride ?? themeStyle('components_DayMediaLightbox_32', {  }, (theme ?? _styleTheme));
  const [expandedIndex, setExpandedIndex] = useState(null);
  const { width } = useWindowDimensions();
  const wideLayout = width >= WIDE_LAYOUT_MIN_WIDTH;

  const close = () => {
    setExpandedIndex(null);
    onClose();
  };

  const expandedItem = expandedIndex != null ? items[expandedIndex] : null;

  return (
    <DialogShell scrollable={false}
      visible={visible}
      title={dayDate ? `Photos & videos — ${dayDate}` : 'Photos & videos'}
      styles={styles}
      onClose={close}
      useNativeModal
      cardStyle={themeStyle('components_DayMediaLightbox_1', {  }, (theme ?? _styleTheme))}
    >
      {expandedItem ? (
        <View style={themeStyle('components_DayMediaLightbox_2', { wideLayout: wideLayout }, (theme ?? _styleTheme))}>
          <View style={themeStyle('components_DayMediaLightbox_3', { wideLayout: wideLayout }, (theme ?? _styleTheme))}>
            <View style={themeStyle('components_DayMediaLightbox_4', {  }, (theme ?? _styleTheme))}>
              <TouchableOpacity accessibilityRole="button" onPress={() => setExpandedIndex(null)}>
                <Text style={themeStyle('components_DayMediaLightbox_5', { textColor: textColor }, (theme ?? _styleTheme))}>‹ Back to all photos</Text>
              </TouchableOpacity>
              {canRemove ? (
                <TouchableOpacity
                  testID={`day-media-lightbox-remove-expanded-${expandedItem.id}`}
                  accessibilityRole="button"
                  disabled={removing}
                  onPress={() => { onRemove(expandedItem); setExpandedIndex(null); }}
                  style={themeStyle('components_DayMediaLightbox_6', {  }, (theme ?? _styleTheme))}
                >
                  <Text style={themeStyle('components_DayMediaLightbox_7', {  }, (theme ?? _styleTheme))}>{removing ? 'Removing…' : 'Remove'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <BlogMediaPreview item={expandedItem} backgroundColor={backgroundColor} />
            {expandedItem.caption ? <Text style={themeStyle('components_DayMediaLightbox_8', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{expandedItem.caption}</Text> : null}
            {canReact && getEngagementSummary && onToggleReaction ? (
              <View style={themeStyle('components_DayMediaLightbox_9', {  }, (theme ?? _styleTheme))}>
                <BlogReactionBar
                  testID={`lightbox-reactions-${expandedItem.assetId}`}
                  targetKind="asset"
                  targetId={expandedItem.assetId}
                  summary={getEngagementSummary(expandedItem.assetId)}
                  canEngage={canReact}
                  onToggle={onToggleReaction}
                  onError={onReactionError}
                  textColor={textColor}
                  mutedColor={mutedColor}
                  theme={theme}
                />
              </View>
            ) : null}
          </View>
          {getComments ? (
            <View
              testID="lightbox-comment-rail"
              style={[
                themeStyle('components_DayMediaLightbox_10', { wideLayout: wideLayout, borderColor: borderColor }, (theme ?? _styleTheme)),
                wideLayout ? themeStyle('components_DayMediaLightbox_11', {  }, (theme ?? _styleTheme)) : themeStyle('components_DayMediaLightbox_12', {  }, (theme ?? _styleTheme)),
              ]}
            >
              <ScrollView style={themeStyle('components_DayMediaLightbox_13', { wideLayout: wideLayout }, (theme ?? _styleTheme))}>
                <BlogCommentThread
                  testID={`lightbox-comments-${expandedItem.assetId}`}
                  comments={getComments(expandedItem.assetId)}
                  targetKind="asset"
                  targetId={expandedItem.assetId}
                  audienceLabel={audienceLabel}
                  currentUserId={currentUserId}
                  canModerate={canModerate}
                  canEngage={canEngage}
                  onPostTopLevel={(body) => onPostComment?.(expandedItem.assetId, body)}
                  onReply={(parentCommentId, body) => onPostComment?.(expandedItem.assetId, body, parentCommentId)}
                  onEdit={(commentId, body) => onEditComment?.(commentId, body) ?? Promise.resolve()}
                  onDelete={(commentId) => onDeleteComment?.(commentId) ?? Promise.resolve()}
                  onReport={(commentId, reason) => onReportComment?.(commentId, reason) ?? Promise.resolve()}
                  onHide={(commentId) => onHideComment?.(commentId) ?? Promise.resolve()}
                  onUnhide={(commentId) => onUnhideComment?.(commentId) ?? Promise.resolve()}
                  onShowEarlierReplies={onShowEarlierReplies}
                  onError={onCommentError ?? (() => {})}
                  textColor={textColor}
                  mutedColor={mutedColor}
                  borderColor={borderColor}
                  backgroundColor={backgroundColor}
                  styles={styles}
                  theme={theme}
                />
              </ScrollView>
            </View>
          ) : null}
        </View>
      ) : (
        <ScrollView style={themeStyle('components_DayMediaLightbox_14', {  }, (theme ?? _styleTheme))}>
          {canRemove ? (
            <Text style={themeStyle('components_DayMediaLightbox_15', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>Tap ✕ on a photo to remove it from this day.</Text>
          ) : null}
          <View style={themeStyle('components_DayMediaLightbox_16', {  }, (theme ?? _styleTheme))}>
            {items.map((item, index) => {
              const summary = getEngagementSummary?.(item.assetId);
              return (
              // Wrapper View so the Remove control is a *sibling* of the tap target, not nested
              // inside it — nested Touchables don't reliably deliver the inner press on web.
              <View key={item.id} style={themeStyle('components_DayMediaLightbox_17', {  }, (theme ?? _styleTheme))}>
              <TouchableOpacity
                testID={`day-media-tile-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={item.kindKey === 'media.video' ? 'Play video' : item.kindKey === 'media.audio' ? 'Play voice note' : 'View photo'}
                onPress={() => setExpandedIndex(index)}
                style={themeStyle('components_DayMediaLightbox_18', { backgroundColor: backgroundColor, borderColor: borderColor }, (theme ?? _styleTheme))}
              >
                {item.kindKey === 'media.audio' ? (
                  <View style={themeStyle('components_DayMediaLightbox_19', {  }, (theme ?? _styleTheme))}><Text style={themeStyle('components_DayMediaLightbox_20', {  }, (theme ?? _styleTheme))}>🎙</Text><Text style={themeStyle('components_DayMediaLightbox_21', { textColor: textColor }, (theme ?? _styleTheme))}>Voice note</Text></View>
                ) : <Image source={{ uri: item.thumbnailUrl || item.primaryUrl }} style={themeStyle('components_DayMediaLightbox_22', {  }, (theme ?? _styleTheme))} resizeMode="cover" />}
                {item.kindKey === 'media.video' ? (
                  <View style={themeStyle('components_DayMediaLightbox_23', {  }, (theme ?? _styleTheme))}>
                    <Text style={themeStyle('components_DayMediaLightbox_24', {  }, (theme ?? _styleTheme))}>▶️</Text>
                  </View>
                ) : null}
                {canReact && summary && summary.reactionTotal > 0 ? (
                  <View
                    testID={`day-media-tile-reaction-badge-${item.id}`}
                    style={themeStyle('components_DayMediaLightbox_25', {  }, (theme ?? _styleTheme))}
                  >
                    <Text style={themeStyle('components_DayMediaLightbox_26', {  }, (theme ?? _styleTheme))}>❤️</Text>
                    <Text style={themeStyle('components_DayMediaLightbox_27', {  }, (theme ?? _styleTheme))}>{summary.reactionTotal}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
              {canRemove ? (
                <TouchableOpacity
                  testID={`day-media-lightbox-remove-${item.id}`}
                  accessibilityRole="button"
                  accessibilityLabel="Remove this photo"
                  disabled={removing}
                  onPress={() => onRemove(item)}
                  style={themeStyle('components_DayMediaLightbox_28', {  }, (theme ?? _styleTheme))}
                >
                  <Text style={themeStyle('components_DayMediaLightbox_29', {  }, (theme ?? _styleTheme))}>{removing ? '…' : '✕'}</Text>
                </TouchableOpacity>
              ) : null}
              </View>
              );
            })}
          </View>
        </ScrollView>
      )}
      <TouchableOpacity
        accessibilityRole="button"
        onPress={close}
        style={[styles?.button, themeStyle('components_DayMediaLightbox_30', { styles: styles, backgroundColor: backgroundColor }, (theme ?? _styleTheme))]}
      >
        <Text style={[styles?.buttonText, themeStyle('components_DayMediaLightbox_31', { textColor: textColor, styles: styles }, (theme ?? _styleTheme))]}>Close</Text>
      </TouchableOpacity>
    </DialogShell>
  );
};

export default DayMediaLightbox;
