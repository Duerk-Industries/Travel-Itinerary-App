import React, { useState } from 'react';
import { ActivityIndicator, Platform, Text, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Modal from './KeyboardAwareModal';
import { uploadOneBlogFile } from '../utils/blogUpload';
import { convertImageToJpeg, isHeicMimeType } from '../utils/heicToJpeg';

type Props = {
  visible: boolean;
  backendUrl: string;
  headers: Record<string, string>;
  tripId: string;
  dayDate?: string;
  styles: Record<string, any>;
  onClose: () => void;
  onSaved: (url: string) => void;
};

export default function BannerPicturePicker({ visible, backendUrl, headers, tripId, dayDate, styles, onClose, onSaved }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pick = async (camera: boolean) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (Platform.OS !== 'web') {
        const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) { setError(`Allow ${camera ? 'camera' : 'photo library'} access in Settings to select a picture.`); return; }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible };
      const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      let uri = asset.uri;
      let mimeType = asset.mimeType || 'image/jpeg';
      if (isHeicMimeType(mimeType, asset.fileName)) {
        const converted = await convertImageToJpeg(uri);
        if (!converted) throw new Error('Please choose a JPEG or PNG picture.');
        uri = converted;
        mimeType = 'image/jpeg';
      }
      const blob = await (await fetch(uri)).blob();
      const uploaded = await uploadOneBlogFile({ backendUrl, headers, tripId }, dayDate ?? '', { blob, mimeType, size: blob.size, name: asset.fileName ?? 'picture.jpg' }, null, [], !dayDate);
      if (uploaded.outcome !== 'ok' || !uploaded.asset) throw new Error(uploaded.error || (uploaded.outcome === 'quota_exceeded' ? 'Your blog storage is full.' : 'Picture uploads are unavailable.'));
      if (dayDate) {
        const response = await fetch(`${backendUrl}/api/trips/${tripId}/blog/days/${dayDate}/cover`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId: uploaded.asset.id }) });
        if (!response.ok) throw new Error('The picture was added to the blog, but could not be selected as the day cover.');
      }
      const url = uploaded.asset.primaryUrl || uploaded.asset.thumbnailUrl;
      if (!url) throw new Error('The picture was uploaded, but is not ready to display. Please try again shortly.');
      onSaved(url);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to change the picture.');
    } finally { setBusy(false); }
  };
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
    <View style={styles.modalOverlay}>
      <View style={[styles.card, { width: '90%', maxWidth: 480, padding: 20, gap: 12 }]}>
        <Text style={styles.sectionTitle}>Change picture</Text>
        <Text style={styles.helperText}>This picture will also appear in the trip blog.</Text>
        {error ? <Text accessibilityRole="alert" style={styles.helperText}>{error}</Text> : null}
        {busy ? <ActivityIndicator /> : null}
        <TouchableOpacity accessibilityRole="button" testID="banner-upload-picture" disabled={busy} style={styles.button} onPress={() => pick(false)}><Text style={styles.buttonText}>Upload picture</Text></TouchableOpacity>
        {Platform.OS !== 'web' ? <TouchableOpacity accessibilityRole="button" testID="banner-take-picture" disabled={busy} style={styles.button} onPress={() => pick(true)}><Text style={styles.buttonText}>Take picture</Text></TouchableOpacity> : null}
        <TouchableOpacity disabled={busy} style={[styles.button, styles.dangerButton]} onPress={onClose}><Text style={styles.dangerButtonText}>Cancel</Text></TouchableOpacity>
      </View>
    </View>
  </Modal>;
}
