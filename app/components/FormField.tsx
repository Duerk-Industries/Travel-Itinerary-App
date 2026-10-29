import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React from 'react';
import { Text, View } from 'react-native';

type FormFieldProps = {
  label: string;
  children: React.ReactNode;
  styles: Record<string, any>;
  hint?: string;
  testID?: string;
};

const FormField: React.FC<FormFieldProps> = ({ label, children, styles, hint, testID }) => { const _styleTheme = useStyleTheme(); return ((
  <View style={themeStyle('components_FormField_1', {  }, _styleTheme)} testID={testID}>
    <Text style={styles.modalLabel ?? styles.headerText}>{label}</Text>
    {children}
    {hint ? <Text style={styles.helperText}>{hint}</Text> : null}
  </View>
)); };

export default FormField;
