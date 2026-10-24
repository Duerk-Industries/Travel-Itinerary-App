import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ActivityDescriptionGenerator from '../components/ActivityDescriptionGenerator';
import { registerLocalDescriptions, withLocalAiLock } from '../utils/localActivityDescriptions';

const input = { name: 'Museum visit', location: 'Tokyo', notes: 'See the ceramics collection.' };

it('shows the button only after a loaded generator is registered and hides it when unloaded', () => {
  const view = render(<ActivityDescriptionGenerator input={input} styles={{}} onApply={jest.fn()} />);
  expect(view.queryByText('Generate description')).toBeNull();
  let unregister = () => {};
  act(() => { unregister = registerLocalDescriptions(async () => 'Draft'); });
  expect(view.getByText('Generate description')).toBeTruthy();
  act(() => unregister());
  expect(view.queryByText('Generate description')).toBeNull();
});

it('keeps a generated draft separate until the user applies it', async () => {
  const generate = jest.fn(async () => 'Visit the museum in Tokyo to see its ceramics collection.');
  const unregister = registerLocalDescriptions(generate);
  try {
    const onApply = jest.fn();
    const view = render(<ActivityDescriptionGenerator input={input} styles={{}} onApply={onApply} />);
    fireEvent.press(view.getByText('Generate description'));
    await waitFor(() => expect(view.getByText('Use description')).toBeTruthy());
    expect(generate).toHaveBeenCalledWith(input);
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.press(view.getByText('Discard draft'));
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.press(view.getByText('Generate description'));
    await waitFor(() => expect(view.getByText('Use description')).toBeTruthy());
    fireEvent.press(view.getByText('Use description'));
    expect(onApply).toHaveBeenCalledWith('Visit the museum in Tokyo to see its ceramics collection.');
  } finally { act(() => unregister()); }
});

it('prevents concurrent use of the local model', async () => {
  let finish = () => {};
  const operation = withLocalAiLock(() => new Promise<void>(resolve => { finish = resolve; }));
  await expect(withLocalAiLock(async () => 'second')).rejects.toThrow('busy');
  finish(); await operation;
});
