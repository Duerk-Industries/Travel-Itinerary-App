import React, { memo, useCallback, useMemo, useState } from 'react';
import { Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
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
    // Native HTML controls do not inherit React Native's Text styles.  Always
    // provide the same themed foreground/background/border as the shared
    // input style so selects remain readable in either appearance mode.
    const themedWebStyle = {
      ...(styles.input ?? {}),
      ...(webStyle ?? {}),
      color: webStyle?.color ?? styles.cellText?.color ?? styles.input?.color,
      backgroundColor: webStyle?.backgroundColor ?? styles.input?.backgroundColor,
      borderColor: webStyle?.borderColor ?? styles.input?.borderColor,
      colorScheme: styles.input?.backgroundColor === '#243647' ? 'dark' : undefined,
    };
    return (
      <select
        style={themedWebStyle}
        title={title ?? placeholder}
        value={value}
        disabled={disabled}
        data-testid={testID}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {!options.some(option => option.value === '') ? <option value="" style={{ color: themedWebStyle.color, backgroundColor: themedWebStyle.backgroundColor }}>
          {placeholder}
        </option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} style={{ color: themedWebStyle.color, backgroundColor: themedWebStyle.backgroundColor }}>
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
          <View style={{ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}>
            <TouchableOpacity
              style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
              accessibilityRole="button"
              accessibilityLabel="Dismiss options"
              onPress={() => setOpen(false)}
            />
            <View
              testID={testID ? `${testID}-options` : undefined}
              accessibilityViewIsModal
              accessibilityLabel={title ?? placeholder}
              style={[
                { backgroundColor: styles.input?.backgroundColor ?? '#fff', borderRadius: 12, padding: 12, width: '100%', maxWidth: 520, maxHeight: '100%', alignSelf: 'center' },
                { borderColor: styles.input?.borderColor, borderWidth: 1 },
              ]}
            >
              <Text accessibilityRole="header" style={[styles.cellText, { fontWeight: '700', marginBottom: 8 }]}>{title ?? placeholder}</Text>
              <ScrollView
                // Inline dropdown positioning must not escape the modal's bounds.
                style={[listStyle, { position: 'relative', top: 0, left: 0, right: 0, bottom: 0, flexShrink: 1 }]}
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
                    testID={testID ? `${testID}-option-${option.value || 'none'}` : undefined}
                  >
                    <Text style={styles.cellText}>{option.label}</Text>
                  </DropdownOptionButton>
                ))}
              </ScrollView>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel selection" onPress={() => setOpen(false)} style={{ padding: 12 }}>
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
