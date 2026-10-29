/** @jest-environment node */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import BannerPicturePicker from '../components/BannerPicturePicker';
import { uploadOneBlogFile } from '../utils/blogUpload';

jest.mock('../utils/blogUpload', () => ({ uploadOneBlogFile: jest.fn() }));

describe('banner picture selection', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.clearAllMocks();
    (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    const picture = { canceled: false, assets: [{ uri: 'file:///picture.jpg', mimeType: 'image/jpeg' }] };
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue(picture);
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue(picture);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => ({ size: 123 }) });
    (uploadOneBlogFile as jest.Mock).mockResolvedValue({ outcome: 'ok', asset: { id: 'photo-1', primaryUrl: 'https://example.com/photo.jpg' } });
  });
  afterEach(() => { global.fetch = originalFetch; });

  it('uploads a day picture and explicitly selects it as the blog cover', async () => {
    const onSaved = jest.fn();
    const onClose = jest.fn();
    const { getByTestId } = render(<BannerPicturePicker visible backendUrl="https://api.test" headers={{ Authorization: 'Bearer test' }} tripId="trip-1" dayDate="2026-11-10" styles={{}} onSaved={onSaved} onClose={onClose} />);
    fireEvent.press(getByTestId('banner-upload-picture'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('https://example.com/photo.jpg'));
    expect(uploadOneBlogFile).toHaveBeenCalledWith(expect.objectContaining({ tripId: 'trip-1' }), '2026-11-10', expect.objectContaining({ size: 123 }), null, [], false);
    expect(global.fetch).toHaveBeenCalledWith('https://api.test/api/trips/trip-1/blog/days/2026-11-10/cover', expect.objectContaining({ method: 'POST', body: JSON.stringify({ assetId: 'photo-1' }) }));
    expect(onClose).toHaveBeenCalled();
  });

  it('takes a trip picture with the native camera without assigning a day', async () => {
    const onSaved = jest.fn();
    const { getByTestId } = render(<BannerPicturePicker visible backendUrl="https://api.test" headers={{}} tripId="trip-1" styles={{}} onSaved={onSaved} onClose={jest.fn()} />);
    fireEvent.press(getByTestId('banner-take-picture'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalled();
    expect(uploadOneBlogFile).toHaveBeenCalledWith(expect.anything(), '', expect.anything(), null, [], true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('leaves the banner unchanged when the user cancels', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: true });
    const onSaved = jest.fn();
    const { getByTestId } = render(<BannerPicturePicker visible backendUrl="https://api.test" headers={{}} tripId="trip-1" styles={{}} onSaved={onSaved} onClose={jest.fn()} />);
    fireEvent.press(getByTestId('banner-upload-picture'));
    await waitFor(() => expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled());
    expect(uploadOneBlogFile).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
