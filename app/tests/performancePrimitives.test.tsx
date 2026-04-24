/**
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import SelectField from '../components/SelectField';
import DraftTextInput from '../components/DraftTextInput';

const styles: Record<string, any> = {
  input: {},
  dropdown: {},
  selectButton: {},
  selectButtonRow: {},
  cellText: {},
  placeholderText: {},
  selectCaret: {},
  dropdownList: {},
  dropdownOption: {},
  dropdownOptionHover: {},
  dropdownOptionPressed: {},
};

describe('performance primitives', () => {
  it('keeps select menu open state local and commits selected values', () => {
    const onChange = jest.fn();
    const { getByLabelText, getByText, queryByText } = render(
      <SelectField
        styles={styles}
        value=""
        placeholder="Days"
        title="Select number of days"
        options={[
          { label: '1', value: '1' },
          { label: '2', value: '2' },
        ]}
        onChange={onChange}
      />
    );

    expect(queryByText('1')).toBeNull();
    fireEvent.press(getByLabelText('Select number of days'));
    fireEvent.press(getByText('2'));
    expect(onChange).toHaveBeenCalledWith('2');
    expect(queryByText('1')).toBeNull();
  });

  it('can defer text input commits until blur', () => {
    const onChangeText = jest.fn();
    const { getByPlaceholderText } = render(
      <DraftTextInput value="old" onChangeText={onChangeText} placeholder="Name" />
    );
    const input = getByPlaceholderText('Name');

    fireEvent.changeText(input, 'new');
    expect(onChangeText).not.toHaveBeenCalled();

    fireEvent(input, 'blur');
    expect(onChangeText).toHaveBeenCalledWith('new');
  });
});
