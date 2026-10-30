// @ts-nocheck
import IconText from './IconText';
import { layoutMetrics, resolveComponentTheme as resolveStyleTheme, themeStyle } from '../theme/theme';



import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
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
  theme?: any;
  canEditMetadata?: boolean;
  canSuggestMetadata?: boolean;
  canRecordCaption?: boolean;
  metadataBusy?: boolean;
  onSaveMetadata?: (item: any, patch: BlogMediaMetadataPatch) => Promise<void>;
  onSuggestMetadata?: (item: any) => Promise<{ caption?: string; altText?: string }>;
  onTranscribeMetadata?: (item: any, recording: { uri: string; mimeType?: string; name?: string }) => Promise<{ caption?: string }>;
  proposedCoverAssetId?: string | null;
};

const MOSAIC_HEIGHT = layoutMetrics.DayMediaGallery_MOSAIC_HEIGHT;
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
  theme: _providedTheme,
  canEditMetadata = false,
  canSuggestMetadata = false,
  canRecordCaption = false,
  metadataBusy = false,
  onSaveMetadata,
  onSuggestMetadata,
  onTranscribeMetadata,
  proposedCoverAssetId = null,
}: DayMediaGalleryProps) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [expandedMetadataItemId, setExpandedMetadataItemId] = useState(null);

  if (!items.length) return null;

  const visible = items.slice(0, MAX_TILES);
  const overflowCount = items.length - visible.length;
  const expandedItem = expandedMetadataItemId ? items.find((item) => item.id === expandedMetadataItemId) : null;

  const editRow = (item: any) => {
    const isCover = item.id === coverItemId;
    const showCoverControl = canSetCover && !isAudioItem(item);
    const showMetadata = (canEditMetadata || canRecordCaption) && !isAudioItem(item) && onSaveMetadata;
    if (!showCoverControl && !canRemove && !showMetadata) return null;
    return (
      <View style={themeStyle('components_DayMediaGallery_1', {  }, (theme ?? _styleTheme))}>
        {showCoverControl ? (
          // Every eligible tile always carries a cover control -- either the filled badge marking
          // the current cover, or an outlined button offering to make this the cover -- rather than
          // the old design where the button was simply absent on whichever tile happened to be the
          // cover. That made cover selection look like buttons randomly appearing/disappearing on
          // other tiles after a click, instead of one obvious, consistent toggle per tile.
          isCover ? (
            <View
              testID={`day-media-cover-badge-${item.id}`}
              accessibilityLabel="This is the current cover photo for this day"
              style={themeStyle('components_DayMediaGallery_2', {  }, (theme ?? _styleTheme))}
            >
              <Text style={themeStyle('components_DayMediaGallery_3', {  }, (theme ?? _styleTheme))}>⭐</Text>
              <Text style={themeStyle('components_DayMediaGallery_4', {  }, (theme ?? _styleTheme))}>Cover</Text>
            </View>
          ) : (
            <TouchableOpacity
              testID={`day-media-set-cover-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel="Set as this day's cover photo"
              disabled={settingCover}
              onPress={() => onSetCover(item)}
              style={themeStyle('components_DayMediaGallery_5', {  }, (theme ?? _styleTheme))}
            >
              <IconText style={themeStyle('components_DayMediaGallery_6', {  }, (theme ?? _styleTheme))}>{settingCover ? '…' : '☆'}</IconText>
            </TouchableOpacity>
          )
        ) : null}
        {showMetadata ? (
          <TouchableOpacity
            testID={`day-media-edit-details-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel="Edit photo details"
            onPress={() => setExpandedMetadataItemId((current) => (current === item.id ? null : item.id))}
            style={themeStyle('components_DayMediaGallery_7', {  }, (theme ?? _styleTheme))}
          >
            <IconText style={themeStyle('components_DayMediaGallery_8', {  }, (theme ?? _styleTheme))}>✎</IconText>
          </TouchableOpacity>
        ) : null}
        {canRemove ? (
          <TouchableOpacity
            testID={`day-media-remove-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel="Remove"
            disabled={removing}
            onPress={() => onRemove(item)}
            style={themeStyle('components_DayMediaGallery_9', {  }, (theme ?? _styleTheme))}
          >
            <IconText style={themeStyle('components_DayMediaGallery_10', {  }, (theme ?? _styleTheme))}>{removing ? '…' : '✕'}</IconText>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const tile = (item: any, tileHeight: number, isLast: boolean, extraStyle: any = {}) => (
    <View key={item.id} style={[themeStyle('components_DayMediaGallery_11', {  }, (theme ?? _styleTheme)), extraStyle]}>
      <TouchableOpacity
        testID={`day-media-grid-tile-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel="Open all trip media for this day"
        activeOpacity={0.85}
        onPress={onOpenLightbox}
      >
        <BlogMediaPreview item={item} backgroundColor={backgroundColor} tileHeight={tileHeight} />
        {isLast && overflowCount > 0 ? (
          <View style={themeStyle('components_DayMediaGallery_12', {  }, (theme ?? _styleTheme))}>
            <Text testID="day-media-overflow-count" style={themeStyle('components_DayMediaGallery_13', {  }, (theme ?? _styleTheme))}>+{overflowCount}</Text>
          </View>
        ) : null}
      </TouchableOpacity>
      {editRow(item)}
      {item.assetId === proposedCoverAssetId && item.id !== coverItemId ? (
        <View testID={`day-media-cover-proposal-${item.id}`} style={themeStyle('components_DayMediaGallery_14', {  }, (theme ?? _styleTheme))}>
          <IconText style={themeStyle('components_DayMediaGallery_15', {  }, (theme ?? _styleTheme))}>♥ Most-loved</IconText>
        </View>
      ) : null}
    </View>
  );

  // Editorial mosaic (redesign notes §3): 1 = full width, 2 = even split, 3 = one large + two
  // stacked, 4+ = one hero + three tiles with a "+N" overlay on the last.
  const mosaic = visible.length === 1 ? (
    <View>{tile(visible[0], MOSAIC_HEIGHT, true)}</View>
  ) : visible.length === 2 ? (
    <View style={themeStyle('components_DayMediaGallery_16', { GAP: GAP }, (theme ?? _styleTheme))}>
      {tile(visible[0], MOSAIC_HEIGHT, false, themeStyle('components_DayMediaGallery_17', {  }, (theme ?? _styleTheme)))}
      {tile(visible[1], MOSAIC_HEIGHT, true, themeStyle('components_DayMediaGallery_18', {  }, (theme ?? _styleTheme)))}
    </View>
  ) : (
    <View style={themeStyle('components_DayMediaGallery_19', { GAP: GAP, MOSAIC_HEIGHT: MOSAIC_HEIGHT }, (theme ?? _styleTheme))}>
      {tile(visible[0], MOSAIC_HEIGHT, false, themeStyle('components_DayMediaGallery_20', {  }, (theme ?? _styleTheme)))}
      <View style={themeStyle('components_DayMediaGallery_21', { GAP: GAP }, (theme ?? _styleTheme))}>
        {visible.slice(1).map((item, i) =>
          tile(item, (MOSAIC_HEIGHT - GAP * (visible.length - 2)) / (visible.length - 1), i === visible.length - 2, themeStyle('components_DayMediaGallery_22', {  }, (theme ?? _styleTheme)))
        )}
      </View>
    </View>
  );

  return (
    <View style={themeStyle('components_DayMediaGallery_23', {  }, (theme ?? _styleTheme))}>
      {mosaic}
      {visible.some((item) => item.caption) ? (
        <View style={themeStyle('components_DayMediaGallery_24', {  }, (theme ?? _styleTheme))}>
          {visible.filter((item) => item.caption).map((item) => (
            <Text key={item.id} testID={`day-media-caption-${item.id}`} style={themeStyle('components_DayMediaGallery_25', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{item.caption}</Text>
          ))}
        </View>
      ) : null}
      {expandedItem ? (
        <BlogMediaMetadataEditor
          item={expandedItem}
          canSuggest={canSuggestMetadata}
          canRecord={canRecordCaption}
          busy={metadataBusy}
          onSave={(patch) => onSaveMetadata(expandedItem, patch)}
          onSuggest={onSuggestMetadata ? () => onSuggestMetadata(expandedItem) : undefined}
          onTranscribe={onTranscribeMetadata ? (recording) => onTranscribeMetadata(expandedItem, recording) : undefined}
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
