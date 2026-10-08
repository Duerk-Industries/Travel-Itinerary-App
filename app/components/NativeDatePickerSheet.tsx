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
import { Modal, Platform, Text, TouchableOpacity, View } from 'react-native';
import type { AppTheme } from '../theme/theme';

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
  return {
    surface: theme?.colors.surface ?? (isDark ? '#243647' : '#FFFFFF'),
    border: theme?.colors.border ?? (isDark ? '#385266' : '#E6ECEF'),
    text: theme?.colors.text ?? (isDark ? '#E6ECEF' : '#111827'),
    mutedText: theme?.colors.textMuted ?? (isDark ? '#B8C2CC' : '#6B7280'),
    // Tint handed to the native picker (matches the app's link/accent color).
    accent: theme?.colors.link ?? (isDark ? '#5FD2E0' : '#45B7C6'),
    // The light theme's link cyan is too low-contrast for text on a white sheet, so the Done
    // label uses the navy brand color in light mode and the (bright) link color in dark mode.
    action: isDark ? (theme?.colors.link ?? '#5FD2E0') : (theme?.colors.primary ?? '#152944'),
  };
};

const NativeDatePickerSheet: React.FC<NativeDatePickerSheetProps> = ({
  visible, onRequestClose, onDone, onCancel, theme, doneLabel = 'Done', testID, children,
}) => {
  if (!visible) return null;
  if (Platform.OS === 'android') return <>{children}</>;
  const colors = getPickerSheetColors(theme);
  const picker = isValidElement(children) && Platform.OS === 'ios'
    ? cloneElement(children as React.ReactElement<any>, {
        display: 'spinner',
        themeVariant: theme?.mode,
        textColor: colors.text,
        accentColor: colors.accent,
      })
    : children;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onRequestClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 24 }}>
          <View style={{ flexDirection: 'row', justifyContent: onCancel ? 'space-between' : 'flex-end', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            {onCancel ? (
              <TouchableOpacity
                testID={testID ? `${testID}-cancel` : undefined}
                accessibilityRole="button"
                onPress={onCancel}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}
              >
                <Text style={{ color: colors.mutedText, fontSize: 16 }}>Cancel</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              testID={testID ? `${testID}-done` : undefined}
              accessibilityRole="button"
              onPress={onDone ?? onRequestClose}
              style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}
            >
              <Text style={{ color: colors.action, fontSize: 16, fontWeight: '700' }}>{doneLabel}</Text>
            </TouchableOpacity>
          </View>
          <View style={{ alignItems: 'center' }}>{picker}</View>
        </View>
      </View>
    </Modal>
  );
};

export default NativeDatePickerSheet;
