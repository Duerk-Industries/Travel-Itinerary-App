import React from 'react';
import { View } from 'react-native';

const DateTimePicker: React.FC<any> = (props) =>
  React.createElement(View, { ...props, testID: 'native-date-time-picker' });

export default DateTimePicker;
