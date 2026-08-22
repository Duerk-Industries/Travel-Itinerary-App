// @ts-nocheck
// Combined per-day photo/video gallery: shows one item at a time (aggregating every traveler's
// uploads for that day, not just the current user's), with prev/next "angle" buttons, the active
// item's caption only, a "Set as day default" action, and a tap-to-open tiled lightbox.
import React, { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { BlogMediaPreview } from './BlogMediaPreview';
import BlogReactionBar from './BlogReactionBar';

type DayMediaGalleryProps = {
  items: any[];
  dayDate?: string;
  coverItemId?: string | null;
  canSetCover?: boolean;
  settingCover?: boolean;
  onSetCover?: (item: any) => void;
  onOpenLightbox?: () => void;
  canRemove?: boolean;
  removing?: boolean;
  onRemove?: (item: any) => void;
  textColor?: string;
  mutedColor?: string;
  borderColor?: string;
  backgroundColor?: string;
  styles?: any;
  // Phase 3 (B1): reaction bar for the active tile. `getEngagementSummary` reads from the parent's
  // normalized engagement store (useBlogEngagement) keyed by the item's `assetId` — every entry
  // here (gallery member or standalone) carries one, per the flattening in tripBlog.tsx.
  canEngage?: boolean;
  getEngagementSummary?: (assetId: string) => any;
  onToggleReaction?: (targetKind: 'asset', targetId: string, emoji: string) => Promise<void>;
  onReactionError?: (message: string) => void;
  theme?: any;
};

const DayMediaGallery = ({
  items,
  dayDate,
  coverItemId = null,
  canSetCover = false,
  settingCover = false,
  onSetCover = () => {},
  onOpenLightbox = () => {},
  canRemove = false,
  removing = false,
  onRemove = () => {},
  textColor,
  mutedColor,
  borderColor,
  backgroundColor,
  styles,
  canEngage = false,
  getEngagementSummary,
  onToggleReaction,
  onReactionError,
  theme,
}: DayMediaGalleryProps) => {
  const [activeIndex, setActiveIndex] = useState(0);

  // Jump to the day's current cover whenever the day changes or a new cover is picked — but not
  // on every refetch, so browsing with prev/next isn't reset out from under the traveler by a
  // routine background reload that happens to return a new array reference for the same content.
  useEffect(() => {
    const index = items.findIndex((item) => item.id === coverItemId);
    setActiveIndex(index >= 0 ? index : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayDate, coverItemId]);

  const clampedIndex = items.length ? Math.min(activeIndex, items.length - 1) : 0;
  const activeItem = items[clampedIndex] ?? null;

  const goPrev = () => setActiveIndex((current) => (items.length ? (current - 1 + items.length) % items.length : 0));
  const goNext = () => setActiveIndex((current) => (items.length ? (current + 1) % items.length : 0));

  const isCurrentCover = useMemo(() => Boolean(activeItem) && activeItem.id === coverItemId, [activeItem, coverItemId]);

  if (!items.length || !activeItem) return null;

  return (
    <View style={{ marginTop: 8 }}>
      <TouchableOpacity testID="day-media-open-lightbox" accessibilityRole="button" accessibilityLabel="Open all photos and videos for this day" activeOpacity={0.85} onPress={onOpenLightbox}>
        <BlogMediaPreview item={activeItem} backgroundColor={backgroundColor} />
      </TouchableOpacity>
      {activeItem.caption ? <Text testID="day-media-caption" style={{ color: mutedColor, marginTop: 4 }}>{activeItem.caption}</Text> : null}
      {getEngagementSummary && onToggleReaction ? (
        <View style={{ marginTop: 4 }}>
          <BlogReactionBar
            testID={`day-media-reactions-${activeItem.assetId}`}
            targetKind="asset"
            targetId={activeItem.assetId}
            summary={getEngagementSummary(activeItem.assetId)}
            canEngage={canEngage}
            onToggle={onToggleReaction}
            onError={onReactionError}
            textColor={textColor}
            mutedColor={mutedColor}
            theme={theme}
            size="compact"
          />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {items.length > 1 ? (
            <>
              <TouchableOpacity testID="day-media-prev" accessibilityRole="button" accessibilityLabel="Previous photo or video" onPress={goPrev} style={{ paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderColor, borderRadius: 6 }}>
                <Text style={{ color: textColor, fontWeight: '700' }}>‹</Text>
              </TouchableOpacity>
              <Text style={{ color: mutedColor, fontSize: 12 }}>{clampedIndex + 1} / {items.length}</Text>
              <TouchableOpacity testID="day-media-next" accessibilityRole="button" accessibilityLabel="Next photo or video" onPress={goNext} style={{ paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderColor, borderRadius: 6 }}>
                <Text style={{ color: textColor, fontWeight: '700' }}>›</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {canSetCover && !isCurrentCover ? (
            <TouchableOpacity testID="day-media-set-cover" accessibilityRole="button" disabled={settingCover} onPress={() => onSetCover(activeItem)} style={[styles?.button, { paddingVertical: 4, paddingHorizontal: 8 }]}>
              <Text style={[styles?.buttonText, { fontSize: 12 }]}>{settingCover ? 'Setting…' : 'Set as day default'}</Text>
            </TouchableOpacity>
          ) : null}
          {canRemove ? (
            <TouchableOpacity testID="day-media-remove" accessibilityRole="button" disabled={removing} onPress={() => onRemove(activeItem)} style={[styles?.button, { paddingVertical: 4, paddingHorizontal: 8, backgroundColor: '#b91c1c' }]}>
              <Text style={[styles?.buttonText, { fontSize: 12 }]}>{removing ? 'Removing…' : 'Remove'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
};

export default DayMediaGallery;
