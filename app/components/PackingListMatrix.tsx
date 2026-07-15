import React, { useMemo, useRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { createPackingListScrollSync } from '../utils/packingListScrollSync';
import { toWebStyle } from '../utils/webStyle';

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
 * Web freezes the header row and item-name column with native CSS
 * `position: sticky` inside one scroll container — simpler and jitter-free
 * compared to synchronizing multiple ScrollViews, and `position: sticky` is
 * not reliably available as a scroll behavior on native, hence the separate
 * native implementation below.
 */
const PackingListMatrixWeb: React.FC<Props> = ({ items, travelers, onToggle, disabled, colors }) => {
  return (
    <View style={toWebStyle(styles.webScroll, { overflow: 'auto', position: 'relative' })} testID="packing-matrix-web-scroll">
      <View style={styles.horizontalRow}>
        <View
          style={toWebStyle({ ...styles.itemHeader, backgroundColor: colors.surface, borderColor: colors.border }, {
            position: 'sticky',
            top: 0,
            left: 0,
            zIndex: 4,
          })}
        >
          <Text style={[styles.headerText, { color: colors.textMuted }]}>Item</Text>
        </View>
        {travelers.map((traveler) => (
          <View
            key={traveler.id}
            style={toWebStyle({ ...styles.travelerHeader, backgroundColor: colors.surface, borderColor: colors.border }, {
              position: 'sticky',
              top: 0,
              zIndex: 3,
            })}
          >
            <Text numberOfLines={1} style={[styles.headerText, { color: colors.textMuted }]}>{traveler.name}</Text>
          </View>
        ))}
      </View>
      {items.map((item) => (
        <View key={item.id} style={styles.horizontalRow}>
          <View
            style={toWebStyle({ ...styles.itemCell, borderColor: colors.border, backgroundColor: item.category ? colors.backgroundAlt : colors.surface }, {
              position: 'sticky',
              left: 0,
              zIndex: 2,
            })}
          >
            <Text style={[styles.itemText, { color: colors.text }]}>{item.label}</Text>
          </View>
          {travelers.map((traveler) => {
            const checked = item.packedBy?.includes(traveler.id) ?? false;
            return (
              <Pressable
                key={`${item.id}-${traveler.id}`}
                testID={`packing-check-${item.id}-${traveler.id}`}
                disabled={disabled || !onToggle}
                onPress={() => onToggle?.(item, traveler)}
                style={[styles.checkCell, { borderColor: colors.border, backgroundColor: colors.surface }]}
              >
                <Text style={[styles.checkText, { color: checked ? colors.success : colors.textMuted }]}>{checked ? '✓' : ''}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
};

/**
 * Four-pane matrix used on native. The two body panes own the scroll state;
 * the other panes are synchronized by offset, so the first column and header
 * stay frozen without a table dependency or per-cell layout virtualization.
 */
const PackingListMatrixNative: React.FC<Props> = ({ items, travelers, onToggle, disabled, colors }) => {
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
    </View>
  );
};

const PackingListMatrix: React.FC<Props> = (props) => (Platform.OS === 'web' ? <PackingListMatrixWeb {...props} /> : <PackingListMatrixNative {...props} />);

const styles = StyleSheet.create({
  root: { minHeight: 100 },
  webScroll: { maxHeight: 520 },
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
