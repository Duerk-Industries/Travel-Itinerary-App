import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { memo, useCallback, useMemo, useState } from 'react';
import { Keyboard, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import DropdownOptionButton from './DropdownOptionButton';
import Modal from './KeyboardAwareModal';

export type SelectFieldOption = {
  label: string;
  value: string;
};

type SelectFieldProps = {
  value: string;
  options: SelectFieldOption[];
  onChange: (value: string) => void;
  styles: Record<string, any>;
  placeholder?: string;
  title?: string;
  style?: any;
  webStyle?: any;
  listStyle?: any;
  testID?: string;
  disabled?: boolean;
};

const SelectFieldComponent: React.FC<SelectFieldProps> = ({
  value,
  options,
  onChange,
  styles,
  placeholder = 'Select',
  title,
  style,
  webStyle,
  listStyle,
  testID,
  disabled,
}) => {
  const _styleTheme = useStyleTheme();
  const [open, setOpen] = useState(false);
  const selectedLabel = useMemo(
    () => options.find((option) => option.value === value)?.label ?? placeholder,
    [options, placeholder, value]
  );

  const toggleOpen = useCallback(() => {
    if (disabled) return;
    // Without this, iOS refocuses the previously active text input when the options modal closes.
    Keyboard.dismiss();
    setOpen((current) => !current);
  }, [disabled]);

  const selectValue = useCallback(
    (nextValue: string) => {
      onChange(nextValue);
      setOpen(false);
    },
    [onChange]
  );

  if (Platform.OS === 'web') {
    // Native HTML controls do not inherit React Native's Text styles.  Always
    // provide the same themed foreground/background/border as the shared
    // input style so selects remain readable in either appearance mode.
    const themedWebStyle = themeStyle('components_SelectField_1', { styles: styles, webStyle: webStyle }, _styleTheme);
    return (
      <select
        style={themedWebStyle}
        title={title ?? placeholder}
        value={value}
        disabled={disabled}
        data-testid={testID}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {!options.some(option => option.value === '') ? <option value="" style={themeStyle('components_SelectField_2', { themedWebStyle: themedWebStyle }, _styleTheme)}>
          {placeholder}
        </option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} style={themeStyle('components_SelectField_3', { themedWebStyle: themedWebStyle }, _styleTheme)}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <View style={[styles.input, styles.dropdown, style]} testID={testID}>
      <TouchableOpacity
        style={styles.selectButton}
        onPress={toggleOpen}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={title ?? placeholder}
        accessibilityState={{ expanded: open, disabled: !!disabled }}
      >
        <View style={styles.selectButtonRow}>
          <Text style={[styles.cellText, !value && styles.placeholderText]}>{selectedLabel}</Text>
          <Text style={styles.selectCaret}>v</Text>
        </View>
      </TouchableOpacity>
      {open && !disabled ? (
        <Modal transparent visible animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={themeStyle('components_SelectField_4', {  }, _styleTheme)}>
            <TouchableOpacity
              style={themeStyle('components_SelectField_5', {  }, _styleTheme)}
              accessibilityRole="button"
              accessibilityLabel="Dismiss options"
              onPress={() => setOpen(false)}
            />
            <View
              testID={testID ? `${testID}-options` : undefined}
              accessibilityViewIsModal
              accessibilityLabel={title ?? placeholder}
              style={[
                themeStyle('components_SelectField_6', { styles: styles }, _styleTheme),
                themeStyle('components_SelectField_7', { styles: styles }, _styleTheme),
              ]}
            >
              <Text accessibilityRole="header" style={[styles.cellText, themeStyle('components_SelectField_8', {  }, _styleTheme)]}>{title ?? placeholder}</Text>
              <ScrollView
                // Inline dropdown positioning must not escape the modal's bounds.
                style={[listStyle, themeStyle('components_SelectField_9', {  }, _styleTheme)]}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
                contentContainerStyle={themeStyle('components_SelectField_10', {  }, _styleTheme)}
              >
                {options.map((option) => (
                  <DropdownOptionButton
                    key={option.value}
                    styles={styles}
                    onPress={() => selectValue(option.value)}
                    accessibilityLabel={`Select ${option.label}`}
                    testID={testID ? `${testID}-option-${option.value || 'none'}` : undefined}
                    selected={option.value === value}
                  >
                    <Text style={styles.cellText}>{option.label}</Text>
                  </DropdownOptionButton>
                ))}
              </ScrollView>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel selection" onPress={() => setOpen(false)} style={themeStyle('components_SelectField_11', {  }, _styleTheme)}>
                <Text style={styles.cellText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
};

const SelectField = memo(SelectFieldComponent);

export default SelectField;
