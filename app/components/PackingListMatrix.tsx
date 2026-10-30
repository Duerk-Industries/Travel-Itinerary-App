import IconText from './IconText';
import { layoutMetrics, themeStyle } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
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

const ITEM_WIDTH = layoutMetrics.PackingListMatrix_ITEM_WIDTH;
const TRAVELER_WIDTH = layoutMetrics.PackingListMatrix_TRAVELER_WIDTH;

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
  const _styleTheme = useStyleTheme();
  return (
    <View
      style={toWebStyle(styles(_styleTheme).webScroll, themeStyle('components_PackingListMatrix_1', { colors: colors, StyleSheet: StyleSheet }, _styleTheme))}
      testID="packing-matrix-web-scroll"
    >
      <View style={toWebStyle(styles(_styleTheme).horizontalRow, themeStyle('components_PackingListMatrix_2', { colors: colors }, _styleTheme))}>
        <View
          style={toWebStyle(themeStyle('components_PackingListMatrix_3', { styles: styles(_styleTheme), colors: colors }, _styleTheme), themeStyle('components_PackingListMatrix_4', {  }, _styleTheme))}
          testID="packing-matrix-web-corner"
        >
          <Text style={[styles(_styleTheme).headerText, themeStyle('components_PackingListMatrix_5', { colors: colors }, _styleTheme)]}>Item</Text>
        </View>
        {travelers.map((traveler) => (
          <View
            key={traveler.id}
            style={toWebStyle(themeStyle('components_PackingListMatrix_6', { styles: styles(_styleTheme), colors: colors }, _styleTheme), themeStyle('components_PackingListMatrix_7', {  }, _styleTheme))}
            testID={`packing-matrix-web-header-${traveler.id}`}
          >
            <Text numberOfLines={1} style={[styles(_styleTheme).headerText, themeStyle('components_PackingListMatrix_8', { colors: colors }, _styleTheme)]}>{traveler.displayName || traveler.name}</Text>
          </View>
        ))}
      </View>
      {items.map((item) => (
        <View key={item.id} style={styles(_styleTheme).horizontalRow}>
          <View
            style={toWebStyle(themeStyle('components_PackingListMatrix_9', { styles: styles(_styleTheme), item: item, colors: colors }, _styleTheme), themeStyle('components_PackingListMatrix_10', {  }, _styleTheme))}
            testID={`packing-matrix-web-item-${item.id}`}
          >
            <Text style={[styles(_styleTheme).itemText, item.isCategory ? styles(_styleTheme).sectionText : null, themeStyle('components_PackingListMatrix_11', { colors: colors }, _styleTheme)]}>{item.label}</Text>
          </View>
          {travelers.map((traveler) => {
            if (item.isCategory) {
              return <View key={`${item.id}-${traveler.id}`} style={[styles(_styleTheme).checkCell, styles(_styleTheme).sectionCell, themeStyle('components_PackingListMatrix_12', { colors: colors }, _styleTheme)]} />;
            }
            const checked = item.packedBy?.includes(traveler.id) ?? false;
            return (
              <Pressable
                key={`${item.id}-${traveler.id}`}
                testID={`packing-check-${item.id}-${traveler.id}`}
                disabled={disabled || !onToggle}
                onPress={() => onToggle?.(item, traveler)}
                style={[styles(_styleTheme).checkCell, themeStyle('components_PackingListMatrix_13', { colors: colors }, _styleTheme)]}
              >
                <IconText style={[styles(_styleTheme).checkText, themeStyle('components_PackingListMatrix_14', { checked: checked, colors: colors }, _styleTheme)]}>{checked ? '✓' : ''}</IconText>
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
  const _styleTheme = useStyleTheme();
  const tableWidth = ITEM_WIDTH + travelers.length * TRAVELER_WIDTH;
  return (
    <View style={[styles(_styleTheme).root, themeStyle('components_PackingListMatrix_15', { StyleSheet: StyleSheet, colors: colors }, _styleTheme)]}>
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator style={styles(_styleTheme).nativeHorizontalScroll}>
        <View style={themeStyle('components_PackingListMatrix_16', { tableWidth: tableWidth }, _styleTheme)}>
          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator stickyHeaderIndices={[0]} style={styles(_styleTheme).nativeVerticalScroll}>
            <View style={[styles(_styleTheme).horizontalRow, themeStyle('components_PackingListMatrix_17', { colors: colors }, _styleTheme)]}>
              <View style={[styles(_styleTheme).itemHeader, themeStyle('components_PackingListMatrix_18', { colors: colors }, _styleTheme)]}>
                <Text style={[styles(_styleTheme).headerText, themeStyle('components_PackingListMatrix_19', { colors: colors }, _styleTheme)]}>Item</Text>
              </View>
              {travelers.map((traveler) => (
                <View key={traveler.id} style={[styles(_styleTheme).travelerHeader, themeStyle('components_PackingListMatrix_20', { colors: colors }, _styleTheme)]}>
                  <Text numberOfLines={1} style={[styles(_styleTheme).headerText, themeStyle('components_PackingListMatrix_21', { colors: colors }, _styleTheme)]}>{traveler.displayName || traveler.name}</Text>
                </View>
              ))}
            </View>
            {items.map((item) => (
              <View key={item.id} style={styles(_styleTheme).horizontalRow}>
                <View style={[styles(_styleTheme).itemCell, item.isCategory ? styles(_styleTheme).sectionCell : null, themeStyle('components_PackingListMatrix_22', { colors: colors, item: item }, _styleTheme)]}>
                  <Text style={[styles(_styleTheme).itemText, item.isCategory ? styles(_styleTheme).sectionText : null, themeStyle('components_PackingListMatrix_23', { colors: colors }, _styleTheme)]}>{item.label}</Text>
                </View>
                {travelers.map((traveler) => {
                  if (item.isCategory) {
                    return <View key={`${item.id}-${traveler.id}`} style={[styles(_styleTheme).checkCell, styles(_styleTheme).sectionCell, themeStyle('components_PackingListMatrix_24', { colors: colors }, _styleTheme)]} />;
                  }
                  const checked = item.packedBy?.includes(traveler.id) ?? false;
                  return (
                    <Pressable
                      key={`${item.id}-${traveler.id}`}
                      testID={`packing-check-${item.id}-${traveler.id}`}
                      disabled={disabled || !onToggle}
                      onPress={() => onToggle?.(item, traveler)}
                      style={[styles(_styleTheme).checkCell, themeStyle('components_PackingListMatrix_25', { colors: colors }, _styleTheme)]}
                    >
                      <IconText style={[styles(_styleTheme).checkText, themeStyle('components_PackingListMatrix_26', { checked: checked, colors: colors }, _styleTheme)]}>{checked ? '✓' : ''}</IconText>
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

const styles = (_theme: import('../theme/theme').AppTheme) => themeStyle('components_PackingListMatrix_27', { StyleSheet: StyleSheet, MATRIX_MAX_HEIGHT: MATRIX_MAX_HEIGHT, ITEM_WIDTH: ITEM_WIDTH, TRAVELER_WIDTH: TRAVELER_WIDTH }, _theme);

export default PackingListMatrix;
