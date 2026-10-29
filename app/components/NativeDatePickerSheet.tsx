import { resolveComponentTheme as resolveStyleTheme, themeStyle, getAppTheme as getStyleTheme, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
// Shared presentation for every native `@react-native-community/datetimepicker` render in the
// app. `DateField` is the only intended caller — screens should render a `DateField` (with
// `mode="date"` or `mode="time"`) rather than wiring this sheet up themselves, so presentation
// and theming stay identical everywhere.
//
// iOS — App Store Guideline 2.1(a) fix ("date selection was unresponsive to taps... on iPad"):
// with no explicit `display`, iOS renders the picker as a popover anchored to the triggering
// view, and on iPad that popover can anchor to a degenerate rect and become untappable. This
// component always requests `display="spinner"` (a self-contained wheel that needs no anchor)
// and presents it inside an explicit bottom-sheet Modal with real Cancel/Done affordances. The
// wheel's `themeVariant`/`textColor` are pinned to the app's resolved appearance (which can
// differ from the device's when the user overrides it in Account settings) so the wheel text is
// never dark-on-dark or light-on-light against the themed sheet.
//
// Android — the platform picker is already its own system dialog (opened imperatively when the
// element mounts, dismissed on pick/cancel), themed consistently by the OS. Wrapping it in our
// sheet only left an empty dimmed sheet with a stray Done button visible behind the dialog, so
// on Android the picker element is rendered bare.
import React, { isValidElement, cloneElement } from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import Modal from './KeyboardAwareModal';


export type NativeDatePickerSheetProps = {
  visible: boolean;
  onRequestClose: () => void;
  onDone?: () => void;
  onCancel?: () => void;
  theme?: AppTheme;
  doneLabel?: string;
  testID?: string;
  children: React.ReactNode;
};

export const getPickerSheetColors = (theme?: AppTheme) => {
  const isDark = theme?.mode === 'dark';
  return themeStyle('components_NativeDatePickerSheet_1', { theme: theme, isDark: isDark }, (theme ?? getStyleTheme('light', 'light')));
};

const NativeDatePickerSheet: React.FC<NativeDatePickerSheetProps> = ({
  visible, onRequestClose, onDone, onCancel, theme: _providedTheme, doneLabel = 'Done', testID, children,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  if (!visible) return null;
  if (Platform.OS === 'android') return <>{children}</>;
  const colors = getPickerSheetColors(theme);
  const picker = isValidElement(children) && Platform.OS === 'ios'
    ? cloneElement(children as React.ReactElement<any>, themeStyle('components_NativeDatePickerSheet_2', { theme: theme, colors: colors }, (theme ?? _styleTheme)))
    : children;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onRequestClose}>
      <View style={themeStyle('components_NativeDatePickerSheet_3', {  }, (theme ?? _styleTheme))}>
        <View style={themeStyle('components_NativeDatePickerSheet_4', { colors: colors }, (theme ?? _styleTheme))}>
          <View style={themeStyle('components_NativeDatePickerSheet_5', { onCancel: onCancel, colors: colors }, (theme ?? _styleTheme))}>
            {onCancel ? (
              <TouchableOpacity
                testID={testID ? `${testID}-cancel` : undefined}
                accessibilityRole="button"
                onPress={onCancel}
                style={themeStyle('components_NativeDatePickerSheet_6', {  }, (theme ?? _styleTheme))}
              >
                <Text style={themeStyle('components_NativeDatePickerSheet_7', { colors: colors }, (theme ?? _styleTheme))}>Cancel</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              testID={testID ? `${testID}-done` : undefined}
              accessibilityRole="button"
              onPress={onDone ?? onRequestClose}
              style={themeStyle('components_NativeDatePickerSheet_8', {  }, (theme ?? _styleTheme))}
            >
              <Text style={themeStyle('components_NativeDatePickerSheet_9', { colors: colors }, (theme ?? _styleTheme))}>{doneLabel}</Text>
            </TouchableOpacity>
          </View>
          <View style={themeStyle('components_NativeDatePickerSheet_10', {  }, (theme ?? _styleTheme))}>{picker}</View>
        </View>
      </View>
    </Modal>
  );
};

export default NativeDatePickerSheet;
