/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ActivityRecapDialog from '../components/ActivityRecapDialog';

const styles = new Proxy({}, { get: () => ({}) }) as Record<string, any>;
const renderDialog = (userStars: number | null) => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const ui = render(
    <ActivityRecapDialog visible activity={{ id: 'a1', name: 'Museum', date: '2027-05-10', userStars }} styles={styles} onClose={jest.fn()} onSave={onSave} onAddMedia={jest.fn()} />
  );
  return { ...ui, onSave };
};

describe('ActivityRecapDialog', () => {
  it('saves the stars a traveler picks', async () => {
    const { getByTestId, onSave } = renderDialog(null);
    fireEvent.press(getByTestId('activity-recap-rating-star-4'));
    fireEvent.press(getByTestId('activity-recap-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ rating: 4, note: '', tags: ['Museum'] }));
  });

  it('lets a traveler change an earlier rating', async () => {
    const { getByTestId, onSave } = renderDialog(5);
    fireEvent.press(getByTestId('activity-recap-rating-star-3'));
    fireEvent.press(getByTestId('activity-recap-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ rating: 3, note: '', tags: ['Museum'] }));
  });

  it('does not resend a rating that did not change', async () => {
    const { getByTestId, onSave } = renderDialog(5);
    fireEvent.press(getByTestId('activity-recap-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ rating: null, note: '', tags: ['Museum'] }));
  });
});
