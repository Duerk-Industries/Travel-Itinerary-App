import React, { memo, useCallback, useMemo, useState } from 'react';
import { Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import DropdownOptionButton from './DropdownOptionButton';

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
  const [open, setOpen] = useState(false);
  const selectedLabel = useMemo(
    () => options.find((option) => option.value === value)?.label ?? placeholder,
    [options, placeholder, value]
  );

  const toggleOpen = useCallback(() => {
    if (!disabled) setOpen((current) => !current);
  }, [disabled]);

  const selectValue = useCallback(
    (nextValue: string) => {
      onChange(nextValue);
      setOpen(false);
    },
    [onChange]
  );

  if (Platform.OS === 'web') {
    return (
      <select
        style={webStyle}
        title={title ?? placeholder}
        value={value}
        disabled={disabled}
        data-testid={testID}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
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
      {open ? (
        <View style={[styles.dropdownList, listStyle]}>
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            contentContainerStyle={{ flexGrow: 1 }}
          >
            {options.map((option) => (
              <DropdownOptionButton
                key={option.value}
                styles={styles}
                onPress={() => selectValue(option.value)}
                accessibilityLabel={`Select ${option.label}`}
              >
                <Text style={styles.cellText}>{option.label}</Text>
              </DropdownOptionButton>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
};

const SelectField = memo(SelectFieldComponent);

export default SelectField;
