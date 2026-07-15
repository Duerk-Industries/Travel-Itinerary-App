import React, { useMemo, useRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { createPackingListScrollSync } from '../utils/packingListScrollSync';

type MatrixItem = {
  id: string;
  label: string;
  category: string;
  position?: number;
  packedBy?: string[];
};
type MatrixTraveler = { id: string; name: string };

type Props = {
  items: MatrixItem[];
  travelers: MatrixTraveler[];
  onToggle?: (item: MatrixItem, traveler: MatrixTraveler) => void;
  disabled?: boolean;
  colors: { border: string; text: string; textMuted: string; backgroundAlt: string; success: string; surface: string };
};

const ITEM_WIDTH = 240;
const TRAVELER_WIDTH = 110;
const HEADER_HEIGHT = 40;

/**
 * Four-pane matrix used on native. The two body panes own the scroll state;
 * the other panes are synchronized by offset, so the first column and header
 * stay frozen without a table dependency or per-cell layout virtualization.
 */
const PackingListMatrix: React.FC<Props> = ({ items, travelers, onToggle, disabled, colors }) => {
  const topHeaderRef = useRef<ScrollView>(null);
  const leftBodyRef = useRef<ScrollView>(null);
  const matrixRef = useRef<ScrollView>(null);
  const matrixBodyRef = useRef<ScrollView>(null);
  const sync = useMemo(() => createPackingListScrollSync({
    horizontalHeader: (x) => topHeaderRef.current?.scrollTo({ x, animated: false }),
    horizontalBody: (x) => matrixRef.current?.scrollTo({ x, animated: false }),
    verticalLabels: (y) => leftBodyRef.current?.scrollTo({ y, animated: false }),
    verticalBody: (y) => matrixBodyRef.current?.scrollTo({ y, animated: false }),
  }), []);

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <View style={[styles.itemHeader, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.headerText, { color: colors.textMuted }]}>Item</Text>
        </View>
        <ScrollView ref={topHeaderRef} horizontal showsHorizontalScrollIndicator={false} scrollEventThrottle={16} onScroll={(event) => sync.syncX(event.nativeEvent.contentOffset.x)}>
          <View style={styles.horizontalRow}>
            {travelers.map((traveler) => <View key={traveler.id} style={[styles.travelerHeader, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text numberOfLines={1} style={[styles.headerText, { color: colors.textMuted }]}>{traveler.name}</Text></View>)}
          </View>
        </ScrollView>
      </View>
      <View style={styles.bodyRow}>
        <ScrollView ref={leftBodyRef} showsVerticalScrollIndicator={false} scrollEventThrottle={16} onScroll={(event) => sync.syncY(event.nativeEvent.contentOffset.y)}>
          {items.map((item) => <View key={`left-${item.id}`} style={[styles.itemCell, { borderColor: colors.border, backgroundColor: item.category ? colors.backgroundAlt : colors.surface }]}><Text style={[styles.itemText, { color: colors.text }]}>{item.label}</Text></View>)}
        </ScrollView>
        <ScrollView ref={matrixRef} horizontal showsHorizontalScrollIndicator scrollEventThrottle={16} onScroll={(event) => sync.syncX(event.nativeEvent.contentOffset.x)}>
          <ScrollView ref={matrixBodyRef} nestedScrollEnabled showsVerticalScrollIndicator scrollEventThrottle={16} onScroll={(event) => sync.syncY(event.nativeEvent.contentOffset.y)}>
            {items.map((item) => <View key={`row-${item.id}`} style={styles.horizontalRow}>
              {travelers.map((traveler) => {
                const checked = item.packedBy?.includes(traveler.id) ?? false;
                return <Pressable key={`${item.id}-${traveler.id}`} testID={`packing-check-${item.id}-${traveler.id}`} disabled={disabled || !onToggle} onPress={() => onToggle?.(item, traveler)} style={[styles.checkCell, { borderColor: colors.border, backgroundColor: colors.surface }]}><Text style={[styles.checkText, { color: checked ? colors.success : colors.textMuted }]}>{checked ? '✓' : ''}</Text></Pressable>;
              })}
            </View>)}
          </ScrollView>
        </ScrollView>
      </View>
      {Platform.OS === 'web' ? <Text style={{ color: colors.textMuted, fontSize: 11 }}>Scroll to view all travelers</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { minHeight: 100 },
  headerRow: { flexDirection: 'row', height: HEADER_HEIGHT },
  bodyRow: { flexDirection: 'row', maxHeight: 520 },
  horizontalRow: { flexDirection: 'row' },
  itemHeader: { width: ITEM_WIDTH, justifyContent: 'center', paddingHorizontal: 10, borderWidth: StyleSheet.hairlineWidth },
  travelerHeader: { width: TRAVELER_WIDTH, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8, borderWidth: StyleSheet.hairlineWidth },
  headerText: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  itemCell: { width: ITEM_WIDTH, minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, borderWidth: StyleSheet.hairlineWidth },
  itemText: { fontSize: 15 },
  checkCell: { width: TRAVELER_WIDTH, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  checkText: { fontSize: 20, fontWeight: '700' },
});

export default PackingListMatrix;
