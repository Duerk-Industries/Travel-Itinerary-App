// Shared bottom-sheet chrome for every native `@react-native-community/datetimepicker` render
// in the app. Extracted so the App Store Guideline 2.1(a) fix ("date selection was unresponsive
// to taps... on iPad") is applied identically everywhere instead of being hand-copied at each of
// the ~10 call sites that render a native date/time picker.
//
// Root cause (see app/components/DateField.tsx for the fuller writeup): with no explicit
// `display`, iOS renders `mode="date"` as a popover anchored to the triggering view, and every
// existing call site rendered the picker as a bare sibling at the bottom of a large scrollable
// form — nowhere near its trigger. On iPad, that popover can anchor to a degenerate rect and
// become effectively untappable. This component fixes it two ways: (1) it always requests
// `display="spinner"` on iOS via the `display` prop it injects onto the picker element, which
// needs no anchor at all, and (2) it presents that picker inside an explicit, always-correctly-
// positioned bottom-sheet Modal instead of leaving positioning to the popover.
//
// Usage: wrap the existing bare `<NativeDateTimePicker ... />` element as `children` — every
// other prop (value, mode, onChange, minimumDate, maximumDate) stays exactly as the call site
// already had it, so per-field onChange semantics (including Android's auto-dismiss-on-pick
// behavior) are untouched. This component only changes *how* the picker is anchored and shown.
import React, { isValidElement, cloneElement } from 'react';
import { Modal, Platform, Text, TouchableOpacity, View } from 'react-native';

export type NativeDatePickerSheetProps = {
  visible: boolean;
  onRequestClose: () => void;
  theme?: { mode?: 'light' | 'dark' };
  doneLabel?: string;
  testID?: string;
  children: React.ReactNode;
};

const NativeDatePickerSheet: React.FC<NativeDatePickerSheetProps> = ({
  visible, onRequestClose, theme, doneLabel = 'Done', testID, children,
}) => {
  if (!visible) return null;
  const picker = isValidElement(children) && Platform.OS === 'ios'
    ? cloneElement(children as React.ReactElement<any>, { display: 'spinner' })
    : children;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onRequestClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <View style={{ backgroundColor: theme?.mode === 'dark' ? '#1C2B3A' : '#FFFFFF', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme?.mode === 'dark' ? '#385266' : '#E6ECEF' }}>
            <TouchableOpacity
              testID={testID ? `${testID}-done` : undefined}
              accessibilityRole="button"
              onPress={onRequestClose}
              style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}
            >
              <Text style={{ color: theme?.mode === 'dark' ? '#5FD2E0' : '#0369a1', fontSize: 16, fontWeight: '700' }}>{doneLabel}</Text>
            </TouchableOpacity>
          </View>
          {picker}
        </View>
      </View>
    </Modal>
  );
};

export default NativeDatePickerSheet;
