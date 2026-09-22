import React from 'react';
import { Platform } from 'react-native';

type PickerMode = 'date' | 'time';
type PickerDisplay = 'default' | 'spinner' | 'compact' | 'inline' | 'calendar' | 'clock';

type UnderlyingPickerProps = {
  value: Date;
  mode: PickerMode;
  display?: PickerDisplay;
  onValueChange: (event: { nativeEvent: unknown }, date: Date) => void;
  onDismiss: () => void;
};

type NativeDateTimePickerProps = {
  value: Date;
  mode: PickerMode;
  display?: PickerDisplay;
  /**
   * Compatibility callback for the app's existing picker call sites. The
   * underlying package exposes granular listeners, which work on iOS Fabric
   * where its legacy `onChange` listener can fail to fire.
   */
  onChange?: (event: { type?: 'set' | 'dismissed'; nativeEvent?: unknown }, date?: Date) => void;
};

type DateTimePickerModule = {
  default?: React.ComponentType<UnderlyingPickerProps>;
};

let UnderlyingPicker: React.ComponentType<UnderlyingPickerProps> | null = null;
if (Platform.OS !== 'web') {
  try {
    // This stays dynamically loaded so the native module is never evaluated
    // in a web bundle.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const module = require('@react-native-community/datetimepicker') as DateTimePickerModule;
    UnderlyingPicker = module.default ?? (module as unknown as React.ComponentType<UnderlyingPickerProps>);
  } catch {
    UnderlyingPicker = null;
  }
}

const NativeDateTimePicker: React.FC<NativeDateTimePickerProps> = ({ onChange, ...props }) => {
  if (!UnderlyingPicker) return null;
  return (
    <UnderlyingPicker
      {...props}
      onValueChange={(event, date) => {
        onChange?.({ type: 'set', nativeEvent: event.nativeEvent }, date);
      }}
      onDismiss={() => {
        onChange?.({ type: 'dismissed' });
      }}
    />
  );
};

export default NativeDateTimePicker;
