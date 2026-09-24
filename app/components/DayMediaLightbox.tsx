// @ts-nocheck
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
const WIDE_LAYOUT_MIN_WIDTH = 700;

const DayMediaLightbox = ({
  visible, items, onClose, dayDate, styles, textColor, mutedColor, borderColor = '#ccd4df', backgroundColor,
  canRemove = false, removing = false, onRemove = () => {},
  canEngage = false, getEngagementSummary, onToggleReaction, onReactionError, theme,
  currentUserId = null, canModerate = false, audienceLabel = null, getComments,
  onPostComment, onEditComment, onDeleteComment, onReportComment, onHideComment, onUnhideComment,
  onShowEarlierReplies, onCommentError,
}: DayMediaLightboxProps) => {
  const [expandedIndex, setExpandedIndex] = useState(null);
  const { width } = useWindowDimensions();
  const wideLayout = width >= WIDE_LAYOUT_MIN_WIDTH;

  const close = () => {
    setExpandedIndex(null);
    onClose();
  };

  const expandedItem = expandedIndex != null ? items[expandedIndex] : null;

  return (
    <DialogShell
      visible={visible}
      title={dayDate ? `Photos & videos — ${dayDate}` : 'Photos & videos'}
      styles={styles}
      onClose={close}
      useNativeModal
      cardStyle={{ maxWidth: 720, width: '92%', maxHeight: '85%' }}
    >
      {expandedItem ? (
        <View style={{ flexDirection: wideLayout ? 'row' : 'column', gap: 12 }}>
          <View style={{ flex: wideLayout ? 3 : undefined }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <TouchableOpacity accessibilityRole="button" onPress={() => setExpandedIndex(null)}>
                <Text style={{ color: textColor, fontWeight: '700' }}>‹ Back to all photos</Text>
              </TouchableOpacity>
              {canRemove ? (
                <TouchableOpacity
                  testID={`day-media-lightbox-remove-expanded-${expandedItem.id}`}
                  accessibilityRole="button"
                  disabled={removing}
                  onPress={() => { onRemove(expandedItem); setExpandedIndex(null); }}
                  style={{ backgroundColor: 'rgba(185,28,28,0.9)', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10 }}
                >
                  <Text style={{ color: '#fff', fontWeight: '600', fontSize: 12 }}>{removing ? 'Removing…' : 'Remove'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <BlogMediaPreview item={expandedItem} backgroundColor={backgroundColor} />
            {expandedItem.caption ? <Text style={{ color: mutedColor, marginTop: 6 }}>{expandedItem.caption}</Text> : null}
            {getEngagementSummary && onToggleReaction ? (
              <View style={{ marginTop: 6 }}>
                <BlogReactionBar
                  testID={`lightbox-reactions-${expandedItem.assetId}`}
                  targetKind="asset"
                  targetId={expandedItem.assetId}
                  summary={getEngagementSummary(expandedItem.assetId)}
                  canEngage={canEngage}
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
                { flex: wideLayout ? 2 : undefined, borderColor, paddingTop: wideLayout ? 0 : 10 },
                wideLayout ? { borderLeftWidth: 1, paddingLeft: 12 } : { borderTopWidth: 1 },
              ]}
            >
              <ScrollView style={{ maxHeight: wideLayout ? 420 : 260 }}>
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
        <ScrollView style={{ maxHeight: 480 }}>
          {canRemove ? (
            <Text style={{ color: mutedColor, fontSize: 12, marginBottom: 8 }}>Tap ✕ on a photo to remove it from this day.</Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {items.map((item, index) => {
              const summary = getEngagementSummary?.(item.assetId);
              return (
              // Wrapper View so the Remove control is a *sibling* of the tap target, not nested
              // inside it — nested Touchables don't reliably deliver the inner press on web.
              <View key={item.id} style={{ width: '31%', aspectRatio: 1, position: 'relative' }}>
              <TouchableOpacity
                testID={`day-media-tile-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={item.kindKey === 'media.video' ? 'Play video' : item.kindKey === 'media.audio' ? 'Play voice note' : 'View photo'}
                onPress={() => setExpandedIndex(index)}
                style={{ width: '100%', height: '100%', borderRadius: 6, overflow: 'hidden', backgroundColor, borderWidth: 1, borderColor }}
              >
                {item.kindKey === 'media.audio' ? (
                  <View style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 28 }}>🎙</Text><Text style={{ color: textColor, fontSize: 11 }}>Voice note</Text></View>
                ) : <Image source={{ uri: item.thumbnailUrl || item.primaryUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />}
                {item.kindKey === 'media.video' ? (
                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 24 }}>▶️</Text>
                  </View>
                ) : null}
                {summary && summary.reactionTotal > 0 ? (
                  <View
                    testID={`day-media-tile-reaction-badge-${item.id}`}
                    style={{ position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 2 }}
                  >
                    <Text style={{ fontSize: 10 }}>❤️</Text>
                    <Text style={{ fontSize: 10, color: '#fff', fontWeight: '700' }}>{summary.reactionTotal}</Text>
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
                  style={{ position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(185,28,28,0.92)', borderRadius: 14, minWidth: 26, minHeight: 26, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{removing ? '…' : '✕'}</Text>
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
        style={[styles?.button, { marginTop: 12, backgroundColor: styles?.buttonSecondary?.backgroundColor ?? styles?.card?.backgroundColor ?? backgroundColor }]}
      >
        <Text style={[styles?.buttonText, { color: textColor ?? styles?.buttonText?.color }]}>Close</Text>
      </TouchableOpacity>
    </DialogShell>
  );
};

export default DayMediaLightbox;
