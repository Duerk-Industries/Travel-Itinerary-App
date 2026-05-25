import { Platform } from 'react-native';

export type CsvExportResult = 'downloaded' | 'shared' | 'unavailable' | 'failed';

const exportOnWeb = (csvContent: string, fileName: string): CsvExportResult => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return 'unavailable';
  }
  try {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
    return 'downloaded';
  } catch {
    return 'failed';
  }
};

const exportOnNative = async (csvContent: string, fileName: string): Promise<CsvExportResult> => {
  try {
    // Lazy-require so the web bundle doesn't pull in the native modules.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FileSystem = require('expo-file-system');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sharing = require('expo-sharing');

    const cacheDir: string | undefined = FileSystem.cacheDirectory;
    if (!cacheDir) return 'unavailable';
    const safeName = fileName.replace(/[^\w.\-]+/g, '_');
    const fileUri = `${cacheDir}${safeName}`;
    await FileSystem.writeAsStringAsync(fileUri, csvContent, {
      encoding: FileSystem.EncodingType?.UTF8 ?? 'utf8',
    });

    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) return 'unavailable';
    await Sharing.shareAsync(fileUri, {
      mimeType: 'text/csv',
      dialogTitle: 'Export CSV',
      UTI: 'public.comma-separated-values-text',
    });
    return 'shared';
  } catch {
    return 'failed';
  }
};

/**
 * Cross-platform CSV export.
 *   - Web: triggers a browser download via a Blob + anchor.
 *   - Native: writes to the app cache directory and opens the system share
 *     sheet so the user can save to Files, email it, etc.
 */
export const exportCsv = async (csvContent: string, fileName: string): Promise<CsvExportResult> => {
  if (Platform.OS === 'web') return exportOnWeb(csvContent, fileName);
  return exportOnNative(csvContent, fileName);
};
