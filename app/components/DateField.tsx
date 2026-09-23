// The one date-entry control every screen should use. Before this, ~10 files each reimplemented
// their own date picker independently — some `<input type="date">`, some three `<select>`
// dropdowns, native handling copy-pasted with small drifts — which is exactly the kind of
// inconsistency that produces the bug App Store review hit on iPad: "date selection was
// unresponsive to taps."
//
// Root cause (confirmed against react-native-datetimepicker's own issue tracker): with no
// explicit `display` prop, iOS's default UIDatePicker presentation for `mode="date"` is a
// popover anchored to the triggering view. Every existing call site rendered the picker as a
// bare sibling at the bottom of a large scrollable form, nowhere near the button that opened it
// — on iPad specifically (a much bigger, differently-laid-out canvas than iPhone, and the actual
// review device), that popover can anchor to a degenerate/incorrect rect and end up effectively
// untappable. `display="inline"` avoids the popover but has its own known freeze when nested in
// a Modal. `display="spinner"` needs no anchor at all — it's a self-contained wheel — which is
// why this component always uses it on iOS, presented inside an explicit bottom-sheet Modal with
// real Cancel/Done affordances instead of an ambiguous tap-outside-to-dismiss.
import React, { useMemo, useState } from 'react';
import { Platform, Text, TouchableOpacity } from 'react-native';
import { toWebStyle } from '../utils/webStyle';
import { normalizeDateString } from '../utils/normalizeDateString';
import NativeDatePickerSheet from './NativeDatePickerSheet';
import NativeDateTimePicker from './NativeDateTimePicker';
import { formatLocalDateOnly, parseLocalDateOnly } from '../utils/dateOnly';

export type DateFieldProps = {
  value: string; // 'YYYY-MM-DD', or '' for empty
  onChange: (isoDate: string) => void;
  styles: Record<string, any>;
  theme?: { mode?: 'light' | 'dark' };
  placeholder?: string;
  minDate?: string;
  maxDate?: string;
  testID?: string;
  accessibilityLabel?: string;
  style?: any;
  disabled?: boolean;
};

const DateField: React.FC<DateFieldProps> = ({
  value, onChange, styles, theme, placeholder = 'YYYY-MM-DD', minDate, maxDate, testID, accessibilityLabel, style, disabled = false,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftDate, setDraftDate] = useState<Date>(() => parseLocalDateOnly(value));

  const webInputStyle = useMemo(
    () => toWebStyle([styles.input, style], {
      width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box',
      colorScheme: theme?.mode === 'dark' ? 'dark' : 'light',
    }),
    [styles, style, theme?.mode]
  );

  if (Platform.OS === 'web') {
    return (
      <input
        type="date"
        title={accessibilityLabel || placeholder}
        aria-label={accessibilityLabel || placeholder}
        // Both attributes point at the same value on purpose: `data-testid` is what a real
        // browser DOM query looks for (matches the convention every other `<input type="date">`
        // in this app already uses), while `testID` is what @testing-library/react-native's
        // getByTestId reads when this same JSX is rendered off react-test-renderer in unit tests.
        data-testid={testID}
        {...({ testID } as any)}
        value={value || ''}
        min={minDate || undefined}
        max={maxDate || undefined}
        disabled={disabled}
        onChange={(e) => onChange(normalizeDateString(e.target.value))}
        style={webInputStyle}
      />
    );
  }

  const openPicker = () => {
    if (disabled) return;
    setDraftDate(parseLocalDateOnly(value));
    setPickerOpen(true);
  };

  return (
    <>
      <TouchableOpacity
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || placeholder}
        style={[styles.input, style, disabled && styles.buttonDisabled]}
        onPress={openPicker}
        disabled={disabled}
      >
        <Text style={styles.cellText}>{value || placeholder}</Text>
      </TouchableOpacity>
      {pickerOpen ? (
        <NativeDatePickerSheet
          visible
          onRequestClose={() => setPickerOpen(false)}
          onCancel={() => setPickerOpen(false)}
          onDone={() => {
            onChange(formatLocalDateOnly(draftDate));
            setPickerOpen(false);
          }}
          theme={theme}
          testID={testID}
        >
          <NativeDateTimePicker
            value={draftDate}
            mode="date"
            minimumDate={minDate ? parseLocalDateOnly(minDate) : undefined}
            maximumDate={maxDate ? parseLocalDateOnly(maxDate) : undefined}
            onChange={(event, date) => {
              if (Platform.OS === 'android') {
                setPickerOpen(false);
                if (event.type === 'set' && date) onChange(formatLocalDateOnly(date));
                return;
              }
              if (date) setDraftDate(date);
            }}
          />
        </NativeDatePickerSheet>
      ) : null}
    </>
  );
};

export default DateField;
