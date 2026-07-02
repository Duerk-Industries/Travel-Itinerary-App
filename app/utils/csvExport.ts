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
    // `expo-file-system` ≥ 19 replaced the legacy `writeAsStringAsync` /
    // `cacheDirectory` helpers with the `Paths` / `File` API. The legacy
    // helpers now throw at runtime, so this path must use the new API.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FileSystem = require('expo-file-system');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sharing = require('expo-sharing');

    const Paths = FileSystem.Paths;
    const FileClass = FileSystem.File;
    if (!Paths?.cache || typeof FileClass !== 'function') return 'unavailable';

    const safeName = fileName.replace(/[^\w.\-]+/g, '_');
    const file = new FileClass(Paths.cache, safeName);
    // `create({ overwrite: true })` silently replaces an existing file; pair
    // with `write` so re-exporting the same trip works without manual cleanup.
    file.create({ overwrite: true });
    file.write(csvContent, { encoding: 'utf8' });

    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) return 'unavailable';
    await Sharing.shareAsync(file.uri, {
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
 *   - Native: writes to the app cache directory via `expo-file-system`'s new
 *     `File` API and opens the system share sheet so the user can save to
 *     Files, email it, etc.
 */
export const exportCsv = async (csvContent: string, fileName: string): Promise<CsvExportResult> => {
  if (Platform.OS === 'web') return exportOnWeb(csvContent, fileName);
  return exportOnNative(csvContent, fileName);
};
