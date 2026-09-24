/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import BlogMediaMetadataEditor from '../components/BlogMediaMetadataEditor';
import { useAudioRecorder, requestRecordingPermissionsAsync } from 'expo-audio';

describe('BlogMediaMetadataEditor', () => {
  it('requires accessible text or an explicit decorative choice before saving', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const view = render(<BlogMediaMetadataEditor item={{ assetId: 'asset-1' }} onSave={onSave} styles={{ button: {}, buttonText: {} }} />);
    expect(view.getByTestId('blog-media-save-metadata').props.accessibilityState?.disabled ?? view.getByTestId('blog-media-save-metadata').props.disabled).toBeTruthy();

    fireEvent.changeText(view.getByTestId('blog-media-alt-text-input'), 'Two travelers beside a lake');
    fireEvent.press(view.getByTestId('blog-media-save-metadata'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ caption: '', altText: 'Two travelers beside a lake', isDecorative: false }));
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
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ caption: '', altText: '', isDecorative: true }));
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

    fireEvent.press(view.getByTestId('blog-media-record-caption'));
    await waitFor(() => expect(stop).toHaveBeenCalled());
    await waitFor(() => expect(onTranscribe).toHaveBeenCalledWith({ uri: 'file:///dictated-caption.m4a', mimeType: 'audio/m4a', name: 'caption-recording.m4a' }));
    await waitFor(() => expect(view.getByTestId('blog-media-caption-input').props.value).toBe('A quiet morning by the lake'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows a notice instead of recording when microphone permission is denied', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false, status: 'denied' });
    const onTranscribe = jest.fn();
    const view = render(
      <BlogMediaMetadataEditor item={{ assetId: 'asset-5' }} canRecord onSave={onSave} onTranscribe={onTranscribe} styles={{ button: {}, buttonText: {} }} />
    );

    fireEvent.press(view.getByTestId('blog-media-record-caption'));
    await waitFor(() => expect(view.getByText('Microphone access is needed to record a caption.')).toBeTruthy());
    expect(onTranscribe).not.toHaveBeenCalled();
  });
});
