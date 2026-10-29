import React, { useState } from 'react';
import ActivityEditForm from '../components/ActivityEditForm';
import { createInitialActivityState } from '../tabs/activities';
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

it('appends generated text immediately while preserving edits made during generation', async () => {
  let finish!: (text: string) => void;
  const unregister = registerLocalDescriptions(() => new Promise<string>(resolve => { finish = resolve; }));
  const onSave = jest.fn();
  const Harness = () => {
    const [draft, setDraft] = useState(() => ({ ...createInitialActivityState(), name: input.name, startLocation: input.location, notes: input.notes }));
    return <ActivityEditForm draft={draft} onChange={setDraft} onSave={onSave} onCancel={jest.fn()} isNew members={[]} styles={{}} />;
  };
  try {
    const view = render(<Harness />);
    fireEvent.press(view.getByText('Generate description'));
    fireEvent.changeText(view.getByPlaceholderText('Description'), 'My updated notes.');
    await act(async () => { finish('A short museum description.'); });
    await waitFor(() => expect(view.getByPlaceholderText('Description').props.value).toBe('My updated notes.\n\nA short museum description.'));
    expect(view.queryByText('Use description')).toBeNull();
    expect(view.queryByText('Discard draft')).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  } finally { act(() => unregister()); }
});

it('prevents concurrent use of the local model', async () => {
  let finish = () => {};
  const operation = withLocalAiLock(() => new Promise<void>(resolve => { finish = resolve; }));
  await expect(withLocalAiLock(async () => 'second')).rejects.toThrow('busy');
  finish(); await operation;
});
