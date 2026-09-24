import React from 'react';
import { View } from 'react-native';

// Preserve picker callbacks on a host component so Jest tests can simulate
// native `onValueChange` and `onDismiss` events without UIKit.
const DateTimePicker: React.FC<any> = (props) =>
  React.createElement(View, { ...props, testID: 'native-date-time-picker' });

export default DateTimePicker;
