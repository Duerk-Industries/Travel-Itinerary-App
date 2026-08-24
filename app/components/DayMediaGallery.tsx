// @ts-nocheck
// Photo mosaic for a day's combined media (every traveler's uploads, not just the current user's).
// Phase 0 of the trip-blog visual redesign (docs/trip-blog-social-prd.md §6.2's gallery + reaction
// badges): replaces the old one-item-at-a-time carousel with a predictable editorial mosaic — 1
// photo full-width, 2 split evenly, 3 one large + two stacked, 4+ one hero + three tiles with a
// "+N" overflow badge on the last one. Every tile opens the same existing tiled DayMediaLightbox
// (which already shows every asset, not just the visible mosaic tiles), so nothing is ever hidden
// behind this preview — it is strictly a richer teaser of what the lightbox already contains.
//
// Cover selection, remove, and metadata editing move from a single "active item" toolbar (the old
// model) to a small per-tile overlay that only appears in edit mode — "edit-mode overlays, not
// permanent controls below the image" per the redesign notes.
import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { BlogMediaPreview } from './BlogMediaPreview';
import BlogReactionBar from './BlogReactionBar';
import BlogMediaMetadataEditor, { type BlogMediaMetadataPatch } from './BlogMediaMetadataEditor';

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
  canEngage?: boolean;
  getEngagementSummary?: (assetId: string) => any;
  onToggleReaction?: (targetKind: 'asset', targetId: string, emoji: string) => Promise<void>;
  onReactionError?: (message: string) => void;
  theme?: any;
  canEditMetadata?: boolean;
  canSuggestMetadata?: boolean;
  metadataBusy?: boolean;
  onSaveMetadata?: (item: any, patch: BlogMediaMetadataPatch) => Promise<void>;
  onSuggestMetadata?: (item: any) => Promise<{ caption?: string; altText?: string }>;
  proposedCoverAssetId?: string | null;
};

const MOSAIC_HEIGHT = 220;
const GAP = 4;
const MAX_TILES = 4;

const isAudioItem = (item: any) => item.mediaKind === 'audio' || item.kindKey === 'media.audio';

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
  canEditMetadata = false,
  canSuggestMetadata = false,
  metadataBusy = false,
  onSaveMetadata,
  onSuggestMetadata,
  proposedCoverAssetId = null,
}: DayMediaGalleryProps) => {
  const [expandedMetadataItemId, setExpandedMetadataItemId] = useState(null);

  if (!items.length) return null;

  const visible = items.slice(0, MAX_TILES);
  const overflowCount = items.length - visible.length;
  const expandedItem = expandedMetadataItemId ? items.find((item) => item.id === expandedMetadataItemId) : null;

  const editRow = (item: any) => {
    const isCover = item.id === coverItemId;
    const showSetCover = canSetCover && !isAudioItem(item) && !isCover;
    const showMetadata = canEditMetadata && !isAudioItem(item) && onSaveMetadata;
    if (!showSetCover && !canRemove && !showMetadata) return null;
    return (
      <View style={{ position: 'absolute', top: 6, right: 6, flexDirection: 'row', gap: 4 }} pointerEvents="box-none">
        {showSetCover ? (
          <TouchableOpacity
            testID={`day-media-set-cover-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel="Set as day default"
            disabled={settingCover}
            onPress={() => onSetCover(item)}
            style={{ backgroundColor: 'rgba(17,24,39,0.65)', borderRadius: 14, paddingVertical: 4, paddingHorizontal: 7 }}
          >
            <Text style={{ color: '#fff', fontSize: 13 }}>{settingCover ? '…' : '⭐'}</Text>
          </TouchableOpacity>
        ) : null}
        {showMetadata ? (
          <TouchableOpacity
            testID={`day-media-edit-details-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel="Edit photo details"
            onPress={() => setExpandedMetadataItemId((current) => (current === item.id ? null : item.id))}
            style={{ backgroundColor: 'rgba(17,24,39,0.65)', borderRadius: 14, paddingVertical: 4, paddingHorizontal: 7 }}
          >
            <Text style={{ color: '#fff', fontSize: 13 }}>✎</Text>
          </TouchableOpacity>
        ) : null}
        {canRemove ? (
          <TouchableOpacity
            testID={`day-media-remove-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel="Remove"
            disabled={removing}
            onPress={() => onRemove(item)}
            style={{ backgroundColor: 'rgba(185,28,28,0.85)', borderRadius: 14, paddingVertical: 4, paddingHorizontal: 7 }}
          >
            <Text style={{ color: '#fff', fontSize: 13 }}>{removing ? '…' : '✕'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const tile = (item: any, tileHeight: number, isLast: boolean, extraStyle: any = {}) => (
    <View key={item.id} style={[{ position: 'relative', overflow: 'hidden', borderRadius: 8 }, extraStyle]}>
      <TouchableOpacity
        testID={`day-media-grid-tile-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel="Open all trip media for this day"
        activeOpacity={0.85}
        onPress={onOpenLightbox}
      >
        <BlogMediaPreview item={item} backgroundColor={backgroundColor} tileHeight={tileHeight} />
        {isLast && overflowCount > 0 ? (
          <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(17,24,39,0.55)', alignItems: 'center', justifyContent: 'center' }}>
            <Text testID="day-media-overflow-count" style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>+{overflowCount}</Text>
          </View>
        ) : null}
      </TouchableOpacity>
      {editRow(item)}
      {item.assetId === proposedCoverAssetId && item.id !== coverItemId ? (
        <View testID={`day-media-cover-proposal-${item.id}`} style={{ position: 'absolute', bottom: 6, left: 6, backgroundColor: 'rgba(124,58,237,0.85)', borderRadius: 12, paddingVertical: 2, paddingHorizontal: 8 }}>
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>♥ Most-loved</Text>
        </View>
      ) : null}
    </View>
  );

  // Editorial mosaic (redesign notes §3): 1 = full width, 2 = even split, 3 = one large + two
  // stacked, 4+ = one hero + three tiles with a "+N" overlay on the last.
  const mosaic = visible.length === 1 ? (
    <View>{tile(visible[0], MOSAIC_HEIGHT, true)}</View>
  ) : visible.length === 2 ? (
    <View style={{ flexDirection: 'row', gap: GAP }}>
      {tile(visible[0], MOSAIC_HEIGHT, false, { flex: 1 })}
      {tile(visible[1], MOSAIC_HEIGHT, true, { flex: 1 })}
    </View>
  ) : (
    <View style={{ flexDirection: 'row', gap: GAP, height: MOSAIC_HEIGHT }}>
      {tile(visible[0], MOSAIC_HEIGHT, false, { flex: 1.6 })}
      <View style={{ flex: 1, gap: GAP }}>
        {visible.slice(1).map((item, i) =>
          tile(item, (MOSAIC_HEIGHT - GAP * (visible.length - 2)) / (visible.length - 1), i === visible.length - 2, { flex: 1 })
        )}
      </View>
    </View>
  );

  return (
    <View style={{ marginTop: 8 }}>
      {mosaic}
      {canEngage && getEngagementSummary && onToggleReaction ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {visible.map((item) => (
            <BlogReactionBar
              key={item.assetId}
              testID={`day-media-reactions-${item.assetId}`}
              targetKind="asset"
              targetId={item.assetId}
              summary={getEngagementSummary(item.assetId)}
              canEngage={canEngage}
              onToggle={onToggleReaction}
              onError={onReactionError}
              textColor={textColor}
              mutedColor={mutedColor}
              theme={theme}
              size="compact"
            />
          ))}
        </View>
      ) : null}
      {visible.some((item) => item.caption) ? (
        <View style={{ marginTop: 4, gap: 2 }}>
          {visible.filter((item) => item.caption).map((item) => (
            <Text key={item.id} testID={`day-media-caption-${item.id}`} style={{ color: mutedColor, fontSize: 12 }}>{item.caption}</Text>
          ))}
        </View>
      ) : null}
      {expandedItem ? (
        <BlogMediaMetadataEditor
          item={expandedItem}
          canSuggest={canSuggestMetadata}
          busy={metadataBusy}
          onSave={(patch) => onSaveMetadata(expandedItem, patch)}
          onSuggest={onSuggestMetadata ? () => onSuggestMetadata(expandedItem) : undefined}
          textColor={textColor}
          mutedColor={mutedColor}
          borderColor={borderColor}
          backgroundColor={backgroundColor}
          styles={styles}
          theme={theme}
        />
      ) : null}
    </View>
  );
};

export default DayMediaGallery;
