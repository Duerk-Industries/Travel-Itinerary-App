import React from 'react';
import { Text, View } from 'react-native';

type FormFieldProps = {
  label: string;
  children: React.ReactNode;
  styles: Record<string, any>;
  hint?: string;
  testID?: string;
};

const FormField: React.FC<FormFieldProps> = ({ label, children, styles, hint, testID }) => (
  <View style={{ marginBottom: 10 }} testID={testID}>
    <Text style={styles.modalLabel ?? styles.headerText}>{label}</Text>
    {children}
    {hint ? <Text style={styles.helperText}>{hint}</Text> : null}
  </View>
);

export default FormField;
