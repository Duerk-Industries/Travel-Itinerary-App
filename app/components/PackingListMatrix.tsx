import React, { useMemo, useRef } from 'react';
import { Dimensions, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { createPackingListScrollSync } from '../utils/packingListScrollSync';
import { toWebStyle } from '../utils/webStyle';

// Some consumers (including lightweight test doubles) do not expose
// Dimensions. Keep the native matrix bounded in those environments while
// using the actual viewport height whenever React Native provides it.
const SCREEN_HEIGHT = Dimensions?.get?.('window')?.height ?? 800;
const MATRIX_MAX_HEIGHT = Math.floor(SCREEN_HEIGHT * 0.7);

type MatrixItem = {
  id: string;
  label: string;
  category: string;
  position?: number;
  packedBy?: string[];
  isCategory?: boolean;
};
type MatrixTraveler = { id: string; name: string; displayName?: string };

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
 * `position: sticky` inside one bounded, self-scrolling container — the
 * same well-established pattern used by most "frozen header" web tables,
 * and the same shape as the native four-pane implementation below (a fixed
 * viewport with its own internal scroll), so behavior is consistent across
 * web/iOS/Android.
 *
 * This box must have a genuine bounded height with overflow on BOTH axes.
 * Setting overflow on only one axis doesn't avoid the other — per the CSS
 * overflow spec, if either axis is non-'visible' the other's computed value
 * becomes 'auto' too — so there is no way to make this container scroll
 * horizontally without it also becoming a (vertical) scroll container. If
 * that vertical scroll container never has a bounded height, it never has
 * actual overflow to scroll, and `position: sticky` bound to it becomes a
 * permanent no-op (indistinguishable from `position: static`) — which is
 * exactly what caused the header to keep scrolling off screen.
 */
const PackingListMatrixWeb: React.FC<Props> = ({ items, travelers, onToggle, disabled, colors }) => {
  return (
    <View
      style={toWebStyle(styles.webScroll, {
        overflow: 'auto',
        position: 'relative',
        maxHeight: '70vh',
        backgroundColor: colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
      })}
      testID="packing-matrix-web-scroll"
    >
      <View style={toWebStyle(styles.horizontalRow, {
        position: 'sticky',
        top: 0,
        zIndex: 10,
        backgroundColor: colors.backgroundAlt,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      })}>
        <View
          style={toWebStyle({ ...styles.itemHeader, backgroundColor: colors.backgroundAlt, borderColor: colors.border }, {
            position: 'sticky',
            top: 0,
            left: 0,
            zIndex: 4,
          })}
          testID="packing-matrix-web-corner"
        >
          <Text style={[styles.headerText, { color: colors.text }]}>Item</Text>
        </View>
        {travelers.map((traveler) => (
          <View
            key={traveler.id}
            style={toWebStyle({ ...styles.travelerHeader, backgroundColor: colors.backgroundAlt, borderColor: colors.border }, {
              position: 'sticky',
              top: 0,
              zIndex: 3,
            })}
            testID={`packing-matrix-web-header-${traveler.id}`}
          >
            <Text numberOfLines={1} style={[styles.headerText, { color: colors.text }]}>{traveler.displayName || traveler.name}</Text>
          </View>
        ))}
      </View>
      {items.map((item) => (
        <View key={item.id} style={styles.horizontalRow}>
          <View
            style={toWebStyle({ ...styles.itemCell, ...(item.isCategory ? styles.sectionCell : {}), borderColor: colors.border, backgroundColor: item.isCategory ? colors.backgroundAlt : colors.surface }, {
              position: 'sticky',
              left: 0,
              zIndex: 2,
            })}
            testID={`packing-matrix-web-item-${item.id}`}
          >
            <Text style={[styles.itemText, item.isCategory ? styles.sectionText : null, { color: colors.text }]}>{item.label}</Text>
          </View>
          {travelers.map((traveler) => {
            if (item.isCategory) {
              return <View key={`${item.id}-${traveler.id}`} style={[styles.checkCell, styles.sectionCell, { borderColor: colors.border, backgroundColor: colors.backgroundAlt }]} />;
            }
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
    <View style={[styles.root, { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }]}>
      <View style={[styles.headerRow, { backgroundColor: colors.backgroundAlt, borderBottomWidth: 1, borderBottomColor: colors.border }]}>
        <View style={[styles.itemHeader, { backgroundColor: colors.backgroundAlt, borderColor: colors.border }]}>
          <Text style={[styles.headerText, { color: colors.text }]}>Item</Text>
        </View>
        <ScrollView ref={topHeaderRef} horizontal style={styles.nativeTravelerScroll} showsHorizontalScrollIndicator={false} scrollEventThrottle={16} onScroll={(event) => { const x = event?.nativeEvent?.contentOffset?.x; if (typeof x === 'number') sync.syncX(x); }}>
          <View style={styles.horizontalRow}>
            {travelers.map((traveler) => <View key={traveler.id} style={[styles.travelerHeader, { backgroundColor: colors.backgroundAlt, borderColor: colors.border }]}><Text numberOfLines={1} style={[styles.headerText, { color: colors.text }]}>{traveler.displayName || traveler.name}</Text></View>)}
          </View>
        </ScrollView>
      </View>
      <View style={styles.bodyRow}>
        <ScrollView ref={leftBodyRef} style={styles.nativeLeftBody} showsVerticalScrollIndicator={false} scrollEventThrottle={16} onScroll={(event) => { const y = event?.nativeEvent?.contentOffset?.y; if (typeof y === 'number') sync.syncY(y); }}>
          {items.map((item) => <View key={`left-${item.id}`} style={[styles.itemCell, item.isCategory ? styles.sectionCell : null, { borderColor: colors.border, backgroundColor: item.isCategory ? colors.backgroundAlt : colors.surface }]}><Text style={[styles.itemText, item.isCategory ? styles.sectionText : null, { color: colors.text }]}>{item.label}</Text></View>)}
        </ScrollView>
        <ScrollView ref={matrixRef} style={styles.nativeMatrixScroll} horizontal nestedScrollEnabled showsHorizontalScrollIndicator scrollEventThrottle={16} onScroll={(event) => { const x = event?.nativeEvent?.contentOffset?.x; if (typeof x === 'number') sync.syncX(x); }}>
          <ScrollView ref={matrixBodyRef} style={styles.nativeMatrixBody} nestedScrollEnabled showsVerticalScrollIndicator scrollEventThrottle={16} onScroll={(event) => { const y = event?.nativeEvent?.contentOffset?.y; if (typeof y === 'number') sync.syncY(y); }}>
            {items.map((item) => <View key={`row-${item.id}`} style={styles.horizontalRow}>
              {travelers.map((traveler) => {
                if (item.isCategory) {
                  return <View key={`${item.id}-${traveler.id}`} style={[styles.checkCell, styles.sectionCell, { borderColor: colors.border, backgroundColor: colors.backgroundAlt }]} />;
                }
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
  webScroll: { width: '100%', maxWidth: '100%' },
  headerRow: { flexDirection: 'row', height: HEADER_HEIGHT, width: '100%' },
  bodyRow: { flexDirection: 'row', maxHeight: MATRIX_MAX_HEIGHT, width: '100%' },
  nativeTravelerScroll: { flex: 1, minWidth: 0 },
  nativeLeftBody: { width: ITEM_WIDTH, maxHeight: MATRIX_MAX_HEIGHT },
  nativeMatrixScroll: { flex: 1, minWidth: 0, maxHeight: MATRIX_MAX_HEIGHT },
  nativeMatrixBody: { maxHeight: MATRIX_MAX_HEIGHT },
  horizontalRow: { flexDirection: 'row', minWidth: '100%' },
  itemHeader: { width: ITEM_WIDTH, justifyContent: 'center', paddingHorizontal: 10, borderWidth: StyleSheet.hairlineWidth },
  travelerHeader: { width: TRAVELER_WIDTH, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8, borderWidth: StyleSheet.hairlineWidth },
  headerText: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  itemCell: { width: ITEM_WIDTH, minHeight: 48, justifyContent: 'center', paddingHorizontal: 10, borderWidth: StyleSheet.hairlineWidth },
  itemText: { fontSize: 14 },
  checkCell: { width: TRAVELER_WIDTH, minHeight: 48, justifyContent: 'center', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  sectionCell: { minHeight: 40, paddingVertical: 8, borderTopWidth: 2 },
  sectionText: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
  checkText: { fontSize: 20, fontWeight: '700' },
});

export default PackingListMatrix;
