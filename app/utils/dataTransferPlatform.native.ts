import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export type PickedCsv = { name: string; size: number; text: string };

export const pickCsvFile = async (): Promise<PickedCsv | null> => {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'application/csv', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const file = new File(asset.uri);
  const size = Number(asset.size ?? file.size ?? 0);
  if (size > 2 * 1024 * 1024) throw new Error('CSV file exceeds the 2 MiB limit.');
  return { name: asset.name || 'import.csv', size, text: await file.text() };
};

export const shareCsvFile = async (filename: string, text: string): Promise<void> => {
  if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing is not available on this device.');
  const file = new File(Paths.cache, filename.replace(/[^a-z0-9._-]+/gi, '_'));
  try {
    file.write(text);
    await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values' });
  } finally {
    try { if (file.exists) file.delete(); } catch { /* cache cleanup is best effort */ }
  }
};
