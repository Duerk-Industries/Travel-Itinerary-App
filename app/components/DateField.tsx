// The one date/time-entry control every screen should use (`mode="date"`, the default, or
// `mode="time"`). Before this, ~10 files each reimplemented their own picker independently —
// some `<input type="date">`, some three `<select>` dropdowns, native handling copy-pasted with
// small drifts, and several parents owning picker state for a child Modal — which is exactly the
// kind of inconsistency that produced the bug App Store review hit on iPad: "date selection was
// unresponsive to taps."
//
// Per platform:
// - Web: a native `<input type="date|time">` styled like the app's other inputs, with the CSS
//   `color-scheme` pinned to the app's resolved appearance so the browser's calendar/clock icon
//   and popup match light/dark mode instead of the OS default.
// - iOS: a tappable field that opens `NativeDatePickerSheet` (spinner wheel in a bottom sheet,
//   Cancel/Done, wheel text pinned to the app theme). See that file for the iPad popover writeup.
// - Android: a tappable field that opens the OS picker dialog, committing on pick.
//
// Because the sheet is rendered by this component (i.e. inside whatever Modal the field lives
// in), it always presents above that Modal — callers never need to hoist picker state up to a
// parent and pass it back down.
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { toWebStyle } from '../utils/webStyle';
import { normalizeDateString } from '../utils/normalizeDateString';
import { formatLocalDateOnly, parseLocalDateOnly } from '../utils/dateOnly';
import type { AppTheme } from '../theme/theme';
import NativeDateTimePicker from './NativeDateTimePicker';
import NativeDatePickerSheet from './NativeDatePickerSheet';

export type DateFieldMode = 'date' | 'time';

export type DateFieldProps = {
  /** 'YYYY-MM-DD' in date mode, 'HH:MM' (24h) in time mode, or '' for empty. */
  value: string;
  onChange: (value: string) => void;
  styles: Record<string, any>;
  theme?: AppTheme;
  mode?: DateFieldMode;
  placeholder?: string;
  minDate?: string;
  maxDate?: string;
  testID?: string;
  accessibilityLabel?: string;
  style?: any;
  disabled?: boolean;
  /** Fired when the user starts interacting (web focus / native picker open) — e.g. to seed defaults. */
  onOpen?: () => void;
};

const flattenStyle = (style: any): Record<string, any> => {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, any>>(
      (flattened, entry) => ({ ...flattened, ...flattenStyle(entry) }),
      {},
    );
  }
  return (StyleSheet.flatten(style) ?? {}) as Record<string, any>;
};

const parseTimeValue = (value: string): Date => {
  const base = new Date();
  const match = value?.match(/^(\d{1,2}):(\d{2})/);
  if (match) base.setHours(Number(match[1]), Number(match[2]), 0, 0);
  else base.setHours(0, 0, 0, 0);
  return base;
};

const formatTimeValue = (date: Date): string =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

const DateField: React.FC<DateFieldProps> = ({
  value, onChange, styles, theme, mode = 'date', placeholder, minDate, maxDate, testID, accessibilityLabel, style, disabled = false, onOpen,
}) => {
  const isTime = mode === 'time';
  const parseValue = (raw: string) => (isTime ? parseTimeValue(raw) : parseLocalDateOnly(raw));
  const formatValue = (date: Date) => (isTime ? formatTimeValue(date) : formatLocalDateOnly(date));
  const resolvedPlaceholder = placeholder ?? (isTime ? 'HH:MM' : 'YYYY-MM-DD');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftDate, setDraftDate] = useState<Date>(() => parseValue(value));

  // If the value changes while the sheet is open (e.g. `onOpen` seeded a default), start the
  // wheel from it rather than from the stale value captured at open time.
  useEffect(() => {
    if (pickerOpen) setDraftDate(parseValue(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const webInputStyle = useMemo(
    // Precedence: theme input style < full-width defaults < caller `style` (e.g. a grid cell's
    // fixed width) < color-scheme, which always tracks the app appearance.
    () => toWebStyle({
      ...flattenStyle(styles.input),
      width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box',
      ...flattenStyle(style),
    }, {
      colorScheme: theme?.mode === 'dark' ? 'dark' : 'light',
    }),
    [styles, style, theme?.mode]
  );

  if (Platform.OS === 'web') {
    return (
      <input
        type={mode}
        title={accessibilityLabel || resolvedPlaceholder}
        aria-label={accessibilityLabel || resolvedPlaceholder}
        // Both attributes point at the same value on purpose: `data-testid` is what a real
        // browser DOM query looks for, while `testID` is what @testing-library/react-native's
        // getByTestId reads when this same JSX is rendered off react-test-renderer in unit tests.
        data-testid={testID}
        {...({ testID } as any)}
        value={value || ''}
        min={isTime ? undefined : minDate || undefined}
        max={isTime ? undefined : maxDate || undefined}
        disabled={disabled}
        onFocus={onOpen}
        onChange={(e) => onChange(isTime ? e.target.value : normalizeDateString(e.target.value))}
        style={webInputStyle}
      />
    );
  }

  const openPicker = () => {
    if (disabled) return;
    onOpen?.();
    setDraftDate(parseValue(value));
    setPickerOpen(true);
  };

  return (
    <>
      <TouchableOpacity
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || resolvedPlaceholder}
        style={[styles.input, { justifyContent: 'center' }, style, disabled && styles.buttonDisabled]}
        onPress={openPicker}
        disabled={disabled}
      >
        <Text style={[styles.cellText, !value && { color: theme?.colors.textMuted }]}>{value || resolvedPlaceholder}</Text>
      </TouchableOpacity>
      <NativeDatePickerSheet
        visible={pickerOpen}
        onRequestClose={() => setPickerOpen(false)}
        onCancel={() => setPickerOpen(false)}
        onDone={() => { onChange(formatValue(draftDate)); setPickerOpen(false); }}
        theme={theme}
        testID={testID}
      >
        <NativeDateTimePicker
          value={draftDate}
          mode={mode}
          minimumDate={!isTime && minDate ? parseLocalDateOnly(minDate) : undefined}
          maximumDate={!isTime && maxDate ? parseLocalDateOnly(maxDate) : undefined}
          onChange={(event, date) => {
            // Android's picker is its own system dialog that dismisses itself on pick/cancel —
            // apply immediately and close; there is no Done button to wait for.
            if (Platform.OS === 'android') {
              setPickerOpen(false);
              if (event?.type === 'set' && date) onChange(formatValue(date));
              return;
            }
            if (date) setDraftDate(date);
          }}
        />
      </NativeDatePickerSheet>
    </>
  );
};

export default DateField;
