/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import VoiceNoteRecorder from '../components/VoiceNoteRecorder';
import { useAudioRecorder, requestRecordingPermissionsAsync } from 'expo-audio';

describe('VoiceNoteRecorder', () => {
  it('records, stops, and hands the recording off to onRecorded', async () => {
    const stop = jest.fn().mockResolvedValue(undefined);
    const record = jest.fn();
    (useAudioRecorder as jest.Mock).mockReturnValue({
      prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
      record,
      stop,
      uri: 'file:///voice-note.m4a',
    });
    const onRecorded = jest.fn().mockResolvedValue(undefined);
    const view = render(<VoiceNoteRecorder onRecorded={onRecorded} />);

    fireEvent.press(view.getByTestId('blog-record-voice-note'));
    await waitFor(() => expect(record).toHaveBeenCalled());
    expect(view.getByText('● Stop')).toBeTruthy();

    fireEvent.press(view.getByTestId('blog-record-voice-note'));
    await waitFor(() => expect(stop).toHaveBeenCalled());
    await waitFor(() => expect(onRecorded).toHaveBeenCalledWith({
      uri: 'file:///voice-note.m4a',
      mimeType: 'audio/m4a',
      name: 'voice-note.m4a',
    }));
  });

  it('reports a message instead of recording when microphone permission is denied', async () => {
    (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false, status: 'denied' });
    const onRecorded = jest.fn();
    const onError = jest.fn();
    const view = render(<VoiceNoteRecorder onRecorded={onRecorded} onError={onError} />);

    fireEvent.press(view.getByTestId('blog-record-voice-note'));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Microphone access is needed to record a voice note.'));
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('ignores taps while disabled', () => {
    const onRecorded = jest.fn();
    const view = render(<VoiceNoteRecorder disabled onRecorded={onRecorded} />);
    fireEvent.press(view.getByTestId('blog-record-voice-note'));
    expect(onRecorded).not.toHaveBeenCalled();
  });
});
