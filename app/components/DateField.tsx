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
import { Modal, Platform, Text, TouchableOpacity, View } from 'react-native';
import { toWebStyle } from '../utils/webStyle';
import { normalizeDateString } from '../utils/normalizeDateString';

type NativeDateTimePickerType = typeof import('@react-native-community/datetimepicker').default;
let NativeDateTimePicker: NativeDateTimePickerType | null = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-community/datetimepicker');
    NativeDateTimePicker = (mod?.default ?? mod) as NativeDateTimePickerType;
  } catch {
    NativeDateTimePicker = null;
  }
}

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

const parseIsoDate = (iso: string): Date => {
  if (!iso) return new Date();
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
};

const toIsoDate = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const DateField: React.FC<DateFieldProps> = ({
  value, onChange, styles, theme, placeholder = 'YYYY-MM-DD', minDate, maxDate, testID, accessibilityLabel, style, disabled = false,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftDate, setDraftDate] = useState<Date>(() => parseIsoDate(value));

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
    setDraftDate(parseIsoDate(value));
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
      {NativeDateTimePicker && pickerOpen ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
          <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
            <View style={{ backgroundColor: theme?.mode === 'dark' ? '#1C2B3A' : '#FFFFFF', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme?.mode === 'dark' ? '#385266' : '#E6ECEF' }}>
                <TouchableOpacity testID={testID ? `${testID}-cancel` : undefined} accessibilityRole="button" onPress={() => setPickerOpen(false)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}>
                  <Text style={{ color: theme?.mode === 'dark' ? '#B8C2CC' : '#6B7280', fontSize: 16 }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID={testID ? `${testID}-done` : undefined}
                  accessibilityRole="button"
                  onPress={() => { onChange(toIsoDate(draftDate)); setPickerOpen(false); }}
                  style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}
                >
                  <Text style={{ color: theme?.mode === 'dark' ? '#5FD2E0' : '#0369a1', fontSize: 16, fontWeight: '700' }}>Done</Text>
                </TouchableOpacity>
              </View>
              <NativeDateTimePicker
                value={draftDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                minimumDate={minDate ? parseIsoDate(minDate) : undefined}
                maximumDate={maxDate ? parseIsoDate(maxDate) : undefined}
                onChange={(event, date) => {
                  // Android's "default" display is already its own modal dialog that dismisses
                  // itself on pick/cancel — apply immediately and close, don't wait for a Done
                  // button that isn't shown for that display mode's own native chrome.
                  if (Platform.OS === 'android') {
                    setPickerOpen(false);
                    if (event?.type === 'set' && date) onChange(toIsoDate(date));
                    return;
                  }
                  if (date) setDraftDate(date);
                }}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
};

export default DateField;
