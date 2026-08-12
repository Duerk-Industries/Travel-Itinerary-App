import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import FormField from './FormField';

type PasswordFieldProps = React.ComponentProps<typeof TextInput> & {
  label: string;
  styles: Record<string, any>;
  testID?: string;
};

const PasswordField: React.FC<PasswordFieldProps> = ({ label, styles, testID, style, ...inputProps }) => {
  const [visible, setVisible] = useState(false);
  return (
    <FormField label={label} styles={styles} testID={testID ? `${testID}-field` : undefined}>
      <View style={{ position: 'relative' }}>
        <TextInput
          {...inputProps}
          testID={testID}
          style={[style, { paddingRight: 52 }]}
          secureTextEntry={!visible}
        />
        <TouchableOpacity
          onPress={() => setVisible((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          testID={testID ? `${testID}-toggle` : undefined}
          style={{ position: 'absolute', right: 8, top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 8 }}
        >
          <Text style={styles.cellText}>{visible ? 'Hide' : 'Show'}</Text>
        </TouchableOpacity>
      </View>
    </FormField>
  );
};

export default PasswordField;
