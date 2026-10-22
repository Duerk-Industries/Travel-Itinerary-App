// Reading a just-recorded or just-picked file back from its local address (blob: on the web,
// file:// on phones). iPhone Safari's fetch() on a blob: address intermittently fails with a bare
// "Load failed"; XMLHttpRequest is the more dependable way to read one, so try that first, fall
// back to fetch, and retry once before giving up.

const readWithXhr = (uri: string): Promise<Blob> =>
  new Promise((resolve, reject) => {
    if (typeof XMLHttpRequest === 'undefined') {
      reject(new Error('XMLHttpRequest unavailable'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('GET', uri, true);
    xhr.responseType = 'blob';
    xhr.onload = () => {
      // Local reads report status 0 in some browsers; any response body counts as success.
      if (xhr.response instanceof Blob || (xhr.response && typeof (xhr.response as Blob).size === 'number')) resolve(xhr.response as Blob);
      else reject(new Error(`Read failed (status ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Load failed'));
    xhr.send();
  });

const readWithFetch = async (uri: string): Promise<Blob> => {
  const response = await fetch(uri);
  return response.blob();
};

export const readLocalBlob = async (uri: string): Promise<Blob> => {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (const read of [readWithXhr, readWithFetch]) {
      try {
        return await read(uri);
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Load failed');
};

const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

/**
 * The audio format a recording really is. Browsers record their own format (iPhone Safari:
 * audio/mp4, Chrome: audio/webm) whatever we asked for, and add codec details we must drop
 * ("audio/mp4;codecs=mp4a.40.2"). Falls back to `fallback` when the type is missing or unknown.
 */
export const actualAudioType = (blobType: string | null | undefined, fallback: string): { mimeType: string; extension: string } => {
  const base = String(blobType ?? '').split(';')[0].trim().toLowerCase();
  if (AUDIO_EXTENSIONS[base]) return { mimeType: base, extension: AUDIO_EXTENSIONS[base] };
  return { mimeType: fallback, extension: AUDIO_EXTENSIONS[fallback] ?? 'm4a' };
};
