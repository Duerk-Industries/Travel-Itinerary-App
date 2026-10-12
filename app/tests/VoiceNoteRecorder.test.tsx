/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import VoiceNoteRecorder from '../components/VoiceNoteRecorder';
import { useAudioRecorder, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';

describe('VoiceNoteRecorder', () => {
  beforeEach(() => {
    (setAudioModeAsync as jest.Mock).mockClear().mockResolvedValue(undefined);
  });

  it('records, stops, and hands the recording off to onRecorded', async () => {
    const stop = jest.fn().mockResolvedValue(undefined);
    const record = jest.fn();
    const calls: string[] = [];
    (setAudioModeAsync as jest.Mock).mockImplementation(async (mode: any) => {
      calls.push(`setAudioModeAsync:${JSON.stringify(mode)}`);
    });
    (useAudioRecorder as jest.Mock).mockReturnValue({
      prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
      record: jest.fn(() => calls.push('record')),
      stop: jest.fn(async () => { calls.push('stop'); }),
      uri: 'file:///voice-note.m4a',
    });
    const onRecorded = jest.fn().mockResolvedValue(undefined);
    const view = render(<VoiceNoteRecorder onRecorded={onRecorded} />);

    fireEvent.press(view.getByTestId('blog-record-voice-note'));
    // The native recorder refuses to record at all until the app's audio session is switched
    // into a recording-capable mode first (iOS throws RecordingDisabledException otherwise) --
    // assert that happens, and happens *before* record() is called.
    await waitFor(() => expect(calls).toContain('record'));
    expect(view.getByText('● Stop')).toBeTruthy();

    fireEvent.press(view.getByTestId('blog-record-voice-note'));
    await waitFor(() => expect(calls).toContain('stop'));
    await waitFor(() => expect(onRecorded).toHaveBeenCalledWith({
      uri: 'file:///voice-note.m4a',
      mimeType: 'audio/m4a',
      name: 'voice-note.m4a',
    }));

    expect(calls).toEqual([
      'setAudioModeAsync:{"allowsRecording":true,"playsInSilentMode":true}',
      'record',
      'stop',
      'setAudioModeAsync:{"allowsRecording":false}',
    ]);
  });

  it('reports a message instead of recording when microphone permission is denied, and never touches the audio session', async () => {
    (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false, status: 'denied' });
    const onRecorded = jest.fn();
    const onError = jest.fn();
    const view = render(<VoiceNoteRecorder onRecorded={onRecorded} onError={onError} />);

    fireEvent.press(view.getByTestId('blog-record-voice-note'));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Microphone access is needed to record a voice note.'));
    expect(onRecorded).not.toHaveBeenCalled();
    expect(setAudioModeAsync).not.toHaveBeenCalled();
  });

  it('reports a message instead of crashing when the device refuses to enable recording', async () => {
    (setAudioModeAsync as jest.Mock).mockRejectedValueOnce(new Error('Recording not allowed on iOS.'));
    const record = jest.fn();
    (useAudioRecorder as jest.Mock).mockReturnValue({
      prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
      record,
      stop: jest.fn().mockResolvedValue(undefined),
      uri: 'file:///voice-note.m4a',
    });
    const onError = jest.fn();
    const view = render(<VoiceNoteRecorder onRecorded={jest.fn()} onError={onError} />);

    fireEvent.press(view.getByTestId('blog-record-voice-note'));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Recording not allowed on iOS.'));
    expect(record).not.toHaveBeenCalled();
    expect(view.getByText('🎙 Record')).toBeTruthy();
  });

  it('ignores taps while disabled', () => {
    const onRecorded = jest.fn();
    const view = render(<VoiceNoteRecorder disabled onRecorded={onRecorded} />);
    fireEvent.press(view.getByTestId('blog-record-voice-note'));
    expect(onRecorded).not.toHaveBeenCalled();
  });
});
