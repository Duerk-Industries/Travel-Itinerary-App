import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import FormField from './FormField';

type PasswordFieldProps = React.ComponentProps<typeof TextInput> & {
  label: string;
  styles: Record<string, any>;
  testID?: string;
};

const PasswordField: React.FC<PasswordFieldProps> = ({ label, styles, testID, style, ...inputProps }) => {
  const _styleTheme = useStyleTheme();
  const [visible, setVisible] = useState(false);
  return (
    <FormField label={label} styles={styles} testID={testID ? `${testID}-field` : undefined}>
      <View style={themeStyle('components_PasswordField_1', {  }, _styleTheme)}>
        <TextInput
          {...inputProps}
          testID={testID}
          style={[style ?? styles.input, themeStyle('components_PasswordField_2', {  }, _styleTheme)]}
          secureTextEntry={!visible}
        />
        <TouchableOpacity
          onPress={() => setVisible((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          testID={testID ? `${testID}-toggle` : undefined}
          style={themeStyle('components_PasswordField_3', {  }, _styleTheme)}
        >
          <Text style={styles.cellText}>{visible ? 'Hide' : 'Show'}</Text>
        </TouchableOpacity>
      </View>
    </FormField>
  );
};

export default PasswordField;
