/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import BlogMediaMetadataEditor from '../components/BlogMediaMetadataEditor';
import { useAudioRecorder, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';

describe('BlogMediaMetadataEditor', () => {
  beforeEach(() => {
    (setAudioModeAsync as jest.Mock).mockClear().mockResolvedValue(undefined);
  });

  it('requires accessible text or an explicit decorative choice before saving', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const view = render(<BlogMediaMetadataEditor item={{ assetId: 'asset-1' }} onSave={onSave} styles={{ button: {}, buttonText: {} }} />);
    expect(view.getByTestId('blog-media-save-metadata').props.accessibilityState?.disabled ?? view.getByTestId('blog-media-save-metadata').props.disabled).toBeTruthy();
    // The disabled Save button must say why, so a caption-only edit (e.g. after dictating a
    // caption, which never fills alt text) isn't a silent dead end.
    expect(view.getByText(/Add alt text \(or mark this photo decorative\) to save/)).toBeTruthy();

    fireEvent.changeText(view.getByTestId('blog-media-alt-text-input'), 'Two travelers beside a lake');
    fireEvent.press(view.getByTestId('blog-media-save-metadata'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ caption: '', tags: [], altText: 'Two travelers beside a lake', isDecorative: false }));
  });

  it('keeps AI output as an editable draft and never saves it automatically', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const onSuggest = jest.fn().mockResolvedValue({ caption: 'Lake day', altText: 'A calm lake at sunset' });
    const view = render(<BlogMediaMetadataEditor item={{ assetId: 'asset-2' }} canSuggest onSave={onSave} onSuggest={onSuggest} styles={{ button: {}, buttonText: {} }} />);

    fireEvent.press(view.getByTestId('blog-media-suggest-metadata'));
    await waitFor(() => expect(view.getByTestId('blog-media-alt-text-input').props.value).toBe('A calm lake at sunset'));
    expect(onSave).not.toHaveBeenCalled();
    expect(view.getByText('AI suggestion added as a draft. Review it before saving.')).toBeTruthy();
  });

  it('allows a traveler to mark a photo decorative', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const view = render(<BlogMediaMetadataEditor item={{ assetId: 'asset-3' }} onSave={onSave} styles={{ button: {}, buttonText: {} }} />);
    fireEvent.press(view.getByTestId('blog-media-decorative-toggle'));
    fireEvent.press(view.getByTestId('blog-media-save-metadata'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ caption: '', tags: [], altText: '', isDecorative: true }));
  });

  it('saves optional comma-separated tags with the media details', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const view = render(<BlogMediaMetadataEditor item={{ assetId: 'asset-tags' }} onSave={onSave} styles={{ button: {}, buttonText: {} }} />);
    fireEvent.changeText(view.getByTestId('blog-media-alt-text-input'), 'A night market');
    fireEvent.changeText(view.getByTestId('blog-media-tags-input'), 'Food, Taipei, Night market');
    fireEvent.press(view.getByTestId('blog-media-save-metadata'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ caption: '', tags: ['Food', 'Taipei', 'Night market'], altText: 'A night market', isDecorative: false }));
  });

  it('records and transcribes a dictated caption as an editable draft', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const stop = jest.fn().mockResolvedValue(undefined);
    const record = jest.fn();
    (useAudioRecorder as jest.Mock).mockReturnValue({
      prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
      record,
      stop,
      uri: 'file:///dictated-caption.m4a',
    });
    const onTranscribe = jest.fn().mockResolvedValue({ caption: 'A quiet morning by the lake' });
    const view = render(
      <BlogMediaMetadataEditor item={{ assetId: 'asset-4' }} canRecord onSave={onSave} onTranscribe={onTranscribe} styles={{ button: {}, buttonText: {} }} />
    );

    fireEvent.press(view.getByTestId('blog-media-record-caption'));
    await waitFor(() => expect(record).toHaveBeenCalled());
    // The native recorder refuses to record at all until the app's audio session is switched
    // into a recording-capable mode first (iOS throws RecordingDisabledException otherwise).
    expect(setAudioModeAsync).toHaveBeenNthCalledWith(1, { allowsRecording: true, playsInSilentMode: true });

    fireEvent.press(view.getByTestId('blog-media-record-caption'));
    await waitFor(() => expect(stop).toHaveBeenCalled());
    await waitFor(() => expect(onTranscribe).toHaveBeenCalledWith({ uri: 'file:///dictated-caption.m4a', mimeType: 'audio/m4a', name: 'caption-recording.m4a' }));
    await waitFor(() => expect(view.getByTestId('blog-media-caption-input').props.value).toBe('A quiet morning by the lake'));
    await waitFor(() => expect(setAudioModeAsync).toHaveBeenNthCalledWith(2, { allowsRecording: false }));
    expect(onSave).not.toHaveBeenCalled();
    // Dictation only ever fills the caption, never alt text, so Save is still disabled here —
    // the transcription notice must say that, not just "review it before saving".
    expect(view.getByText('Transcribed — add alt text (or mark decorative) below, then save.')).toBeTruthy();
  });

  it('shows a notice instead of recording when microphone permission is denied, and never touches the audio session', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false, status: 'denied' });
    const onTranscribe = jest.fn();
    const view = render(
      <BlogMediaMetadataEditor item={{ assetId: 'asset-5' }} canRecord onSave={onSave} onTranscribe={onTranscribe} styles={{ button: {}, buttonText: {} }} />
    );

    fireEvent.press(view.getByTestId('blog-media-record-caption'));
    await waitFor(() => expect(view.getByText('Microphone access is needed to record a caption.')).toBeTruthy());
    expect(onTranscribe).not.toHaveBeenCalled();
    expect(setAudioModeAsync).not.toHaveBeenCalled();
  });

  it('shows a notice instead of crashing when the device refuses to enable recording', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    (setAudioModeAsync as jest.Mock).mockRejectedValueOnce(new Error('Recording not allowed on iOS.'));
    const record = jest.fn();
    (useAudioRecorder as jest.Mock).mockReturnValue({
      prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
      record,
      stop: jest.fn().mockResolvedValue(undefined),
      uri: 'file:///dictated-caption.m4a',
    });
    const onTranscribe = jest.fn();
    const view = render(
      <BlogMediaMetadataEditor item={{ assetId: 'asset-6' }} canRecord onSave={onSave} onTranscribe={onTranscribe} styles={{ button: {}, buttonText: {} }} />
    );

    fireEvent.press(view.getByTestId('blog-media-record-caption'));
    await waitFor(() => expect(view.getByText('Recording not allowed on iOS.')).toBeTruthy());
    expect(record).not.toHaveBeenCalled();
    expect(onTranscribe).not.toHaveBeenCalled();
  });
});
