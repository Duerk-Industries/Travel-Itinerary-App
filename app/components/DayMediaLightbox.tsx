// @ts-nocheck
// Tiled grid of every photo/video for a day, opened by tapping the DayMediaGallery default view.
// Tapping a photo tile enlarges it inline; tapping a video tile plays it inline (via the same
// platform-conditional BlogMediaPreview branch the default view already uses).
import React, { useState } from 'react';
import { Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import DialogShell from './DialogShell';
import { BlogMediaPreview } from './BlogMediaPreview';

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
};

const DayMediaLightbox = ({ visible, items, onClose, dayDate, styles, textColor, mutedColor, borderColor = '#ccd4df', backgroundColor }: DayMediaLightboxProps) => {
  const [expandedIndex, setExpandedIndex] = useState(null);

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
        <View>
          <TouchableOpacity accessibilityRole="button" onPress={() => setExpandedIndex(null)} style={{ marginBottom: 8 }}>
            <Text style={{ color: textColor, fontWeight: '700' }}>‹ Back to all photos</Text>
          </TouchableOpacity>
          <BlogMediaPreview item={expandedItem} backgroundColor={backgroundColor} />
          {expandedItem.caption ? <Text style={{ color: mutedColor, marginTop: 6 }}>{expandedItem.caption}</Text> : null}
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 480 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {items.map((item, index) => (
              <TouchableOpacity
                key={item.id}
                testID={`day-media-tile-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={item.kindKey === 'media.video' ? 'Play video' : 'View photo'}
                onPress={() => setExpandedIndex(index)}
                style={{ width: '31%', aspectRatio: 1, borderRadius: 6, overflow: 'hidden', backgroundColor, borderWidth: 1, borderColor }}
              >
                <Image source={{ uri: item.thumbnailUrl || item.primaryUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                {item.kindKey === 'media.video' ? (
                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 24 }}>▶️</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}
      <TouchableOpacity accessibilityRole="button" onPress={close} style={[styles?.button, { marginTop: 12, backgroundColor: styles?.buttonSecondary?.backgroundColor ?? '#e5e7eb' }]}>
        <Text style={[styles?.buttonText, { color: textColor }]}>Close</Text>
      </TouchableOpacity>
    </DialogShell>
  );
};

export default DayMediaLightbox;
