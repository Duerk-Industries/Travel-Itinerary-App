/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { Text, TextInput } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import FormField from '../components/FormField';
import PasswordField from '../components/PasswordField';

// Covers implementation-plan-ux-remediation.md Initiative E: persistent field
// labels (that stay visible while typing, unlike placeholder-only fields)
// and a password-visibility toggle.
const styles: Record<string, any> = {
  modalLabel: {},
  helperText: {},
  input: {},
  cellText: {},
};

describe('FormField', () => {
  it('renders the label alongside its child input', () => {
    const { getByText, getByTestId } = render(
      <FormField label="First name" styles={styles} testID="first-name-field">
        <TextInput testID="first-name-input" />
      </FormField>
    );
    expect(getByText('First name')).toBeTruthy();
    expect(getByTestId('first-name-input')).toBeTruthy();
  });

  it('keeps the label visible after the user types into the field', () => {
    const Harness = () => {
      const [value, setValue] = React.useState('');
      return (
        <FormField label="Email" styles={styles}>
          <TextInput testID="email-input" value={value} onChangeText={setValue} />
        </FormField>
      );
    };
    const { getByText, getByTestId } = render(<Harness />);
    fireEvent.changeText(getByTestId('email-input'), 'rose@example.com');
    // The bug this regression-proofs: a placeholder-only field loses its
    // label the moment the placeholder is replaced by typed text. FormField's
    // label is a sibling <Text>, not the input's placeholder, so it stays.
    expect(getByText('Email')).toBeTruthy();
  });

  it('renders an optional hint below the field', () => {
    const { getByText } = render(
      <FormField label="Destination" styles={styles} hint="Search by city or country">
        <Text>child</Text>
      </FormField>
    );
    expect(getByText('Search by city or country')).toBeTruthy();
  });
});

describe('PasswordField', () => {
  it('masks the value by default', () => {
    const { getByTestId } = render(<PasswordField label="Password" styles={styles} testID="pw" />);
    expect(getByTestId('pw').props.secureTextEntry).toBe(true);
  });

  it('reveals the value when the toggle is pressed, and re-masks on a second press', () => {
    const { getByTestId } = render(<PasswordField label="Password" styles={styles} testID="pw" />);
    fireEvent.press(getByTestId('pw-toggle'));
    expect(getByTestId('pw').props.secureTextEntry).toBe(false);
    fireEvent.press(getByTestId('pw-toggle'));
    expect(getByTestId('pw').props.secureTextEntry).toBe(true);
  });

  it('does not alter the typed value when toggling visibility', () => {
    const Harness = () => {
      const [value, setValue] = React.useState('');
      return <PasswordField label="Password" styles={styles} testID="pw" value={value} onChangeText={setValue} />;
    };
    const { getByTestId } = render(<Harness />);
    fireEvent.changeText(getByTestId('pw'), 'hunter2');
    fireEvent.press(getByTestId('pw-toggle'));
    expect(getByTestId('pw').props.value).toBe('hunter2');
  });

  it('exposes an accessible label on the toggle that reflects the current state', () => {
    const { getByTestId } = render(<PasswordField label="Password" styles={styles} testID="pw" />);
    const toggle = getByTestId('pw-toggle');
    expect(toggle.props.accessibilityLabel).toMatch(/show password/i);
    fireEvent.press(toggle);
    expect(toggle.props.accessibilityLabel).toMatch(/hide password/i);
  });

  it('renders its label via FormField so it stays visible while typing', () => {
    const { getByText, getByTestId } = render(<PasswordField label="Confirm password" styles={styles} testID="pw" />);
    fireEvent.changeText(getByTestId('pw'), 'a-new-password');
    expect(getByText('Confirm password')).toBeTruthy();
  });
});
