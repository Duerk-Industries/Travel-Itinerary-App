import React from 'react';
import { Dimensions, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

/**
 * Web freezes the header row and item-name column with native CSS
 * `position: sticky` inside one bounded, self-scrolling container — the
 * same well-established pattern used by most "frozen header" web tables.
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
 * Native matrix: a single horizontal ScrollView (matching the
 * `HorizontalTableScroll` pattern already used by every other data table in
 * this app, e.g. activities.tsx) wrapping a single vertical ScrollView whose
 * header row is frozen via `stickyHeaderIndices`.
 *
 * This replaces an earlier four-pane implementation that kept the header row
 * and item column frozen by synchronizing four separate ScrollViews'
 * offsets via JS callbacks. That meant the actual checklist body lived
 * inside two *nested same-parent* ScrollViews (a horizontal one wrapping a
 * vertical one) sitting inside the *header's own* horizontal ScrollView tree
 * — `nestedScrollEnabled` only does anything on Android, so on iOS the inner
 * gesture recognizers competed for the touch and the body largely refused to
 * scroll at all; only the plain, non-nested header ScrollView reliably
 * responded to a drag, and its onScroll handler then pushed that offset into
 * the (visually static) body. One level of horizontal-in-vertical nesting,
 * as used here, is the shape already proven to work across the rest of the
 * app. The tradeoff is the item-name column no longer freezes while
 * scrolling horizontally — a cosmetic loss, but a functionally scrollable
 * list matters more than a frozen column that wasn't reliably reachable.
 */
const PackingListMatrixNative: React.FC<Props> = ({ items, travelers, onToggle, disabled, colors }) => {
  const tableWidth = ITEM_WIDTH + travelers.length * TRAVELER_WIDTH;
  return (
    <View style={[styles.root, { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }]}>
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator style={styles.nativeHorizontalScroll}>
        <View style={{ width: tableWidth }}>
          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator stickyHeaderIndices={[0]} style={styles.nativeVerticalScroll}>
            <View style={[styles.horizontalRow, { backgroundColor: colors.backgroundAlt, borderBottomWidth: 1, borderBottomColor: colors.border }]}>
              <View style={[styles.itemHeader, { backgroundColor: colors.backgroundAlt, borderColor: colors.border }]}>
                <Text style={[styles.headerText, { color: colors.text }]}>Item</Text>
              </View>
              {travelers.map((traveler) => (
                <View key={traveler.id} style={[styles.travelerHeader, { backgroundColor: colors.backgroundAlt, borderColor: colors.border }]}>
                  <Text numberOfLines={1} style={[styles.headerText, { color: colors.text }]}>{traveler.displayName || traveler.name}</Text>
                </View>
              ))}
            </View>
            {items.map((item) => (
              <View key={item.id} style={styles.horizontalRow}>
                <View style={[styles.itemCell, item.isCategory ? styles.sectionCell : null, { borderColor: colors.border, backgroundColor: item.isCategory ? colors.backgroundAlt : colors.surface }]}>
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
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
};

const PackingListMatrix: React.FC<Props> = (props) => (Platform.OS === 'web' ? <PackingListMatrixWeb {...props} /> : <PackingListMatrixNative {...props} />);

const styles = StyleSheet.create({
  root: { minHeight: 100 },
  webScroll: { width: '100%', maxWidth: '100%' },
  nativeHorizontalScroll: { width: '100%' },
  nativeVerticalScroll: { maxHeight: MATRIX_MAX_HEIGHT },
  // Deliberately no `minWidth: '100%'` here. A row's width should be exactly
  // its real columns (item column + one per traveler) so header and body
  // rows always measure identically -- forcing every row to additionally
  // fill the scroll viewport's full width (which can be much wider than the
  // real columns when a trip has only one or two travelers) left a stretch
  // of background-colored blank space trailing after the last real column,
  // which read as a spurious extra "blank column".
  horizontalRow: { flexDirection: 'row' },
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
