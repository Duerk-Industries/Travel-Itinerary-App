/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import BlogDayStarterCard from '../components/BlogDayStarterCard';

const styles = { button: {}, buttonText: {} } as any;

describe('BlogDayStarterCard', () => {
  it('renders the draft and calls onUse when "Use this draft" is pressed', () => {
    const onUse = jest.fn();
    const screen = render(
      <BlogDayStarterCard draft="Louvre Museum is a stop your group may enjoy." onUse={onUse} onDismiss={jest.fn()} styles={styles} testID="starter" />
    );
    expect(screen.getByText('Louvre Museum is a stop your group may enjoy.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('starter-use'));
    expect(onUse).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss from both the ✕ and the "Not now" button', () => {
    const onDismiss = jest.fn();
    const screen = render(
      <BlogDayStarterCard draft="3 photos from Tuesday." onUse={jest.fn()} onDismiss={onDismiss} styles={styles} testID="starter" />
    );
    fireEvent.press(screen.getByTestId('starter-dismiss'));
    fireEvent.press(screen.getByTestId('starter-notnow'));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('disables the actions while busy', () => {
    const onUse = jest.fn();
    const onDismiss = jest.fn();
    const screen = render(
      <BlogDayStarterCard draft="A day." busy onUse={onUse} onDismiss={onDismiss} styles={styles} testID="starter" />
    );
    fireEvent.press(screen.getByTestId('starter-use'));
    fireEvent.press(screen.getByTestId('starter-notnow'));
    expect(onUse).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
