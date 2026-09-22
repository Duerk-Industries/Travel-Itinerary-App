import { readImageCaptureMetadataFromBuffer, readNativeExifCapture } from '../utils/exifCapture';

// Builds a minimal little-endian JPEG/Exif buffer: SOI + APP1("Exif\0\0" + TIFF) with an IFD0
// that points to an Exif sub-IFD carrying one DateTimeOriginal (0x9003) ASCII value, and
// optionally a GPS sub-IFD.
const buildJpegExif = (opts: { date?: string; gps?: { latDms: [number, number, number]; latRef: string; lngDms: [number, number, number]; lngRef: string } }): ArrayBuffer => {
  const date = opts.date ?? '2026:09:01 14:30:00';
  const dateBytes = Buffer.from(date + '\0', 'ascii');

  // TIFF block laid out sequentially; offsets are relative to tiffStart (start of "II").
  const chunks: Buffer[] = [];
  let cursor = 0;
  const push = (b: Buffer) => { chunks.push(b); cursor += b.length; };
  const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const rational = (num: number, den: number) => Buffer.concat([u32(num), u32(den)]);

  // Header
  push(Buffer.from('II', 'ascii'));
  push(u16(0x2a));
  push(u32(8)); // IFD0 at offset 8

  const hasGps = !!opts.gps;
  const ifd0Entries = 1 + (hasGps ? 1 : 0);
  const ifd0Size = 2 + ifd0Entries * 12 + 4;
  const exifIfdOffset = 8 + ifd0Size;
  const exifIfdSize = 2 + 1 * 12 + 4;
  const dateValueOffset = exifIfdOffset + exifIfdSize;
  const gpsIfdOffset = dateValueOffset + dateBytes.length;

  // IFD0
  push(u16(ifd0Entries));
  push(Buffer.concat([u16(0x8769), u16(4), u32(1), u32(exifIfdOffset)])); // Exif IFD pointer
  if (hasGps) push(Buffer.concat([u16(0x8825), u16(4), u32(1), u32(gpsIfdOffset)])); // GPS IFD pointer
  push(u32(0)); // next IFD

  // Exif sub-IFD
  push(u16(1));
  push(Buffer.concat([u16(0x9003), u16(2), u32(dateBytes.length), u32(dateValueOffset)])); // DateTimeOriginal
  push(u32(0));

  // Date string value
  push(dateBytes);

  // GPS sub-IFD
  if (hasGps) {
    const g = opts.gps!;
    const gpsValuesStart = gpsIfdOffset + 2 + 4 * 12 + 4;
    push(u16(4));
    push(Buffer.concat([u16(0x0001), u16(2), u32(2), Buffer.from(g.latRef + '\0', 'ascii'), Buffer.alloc(2)])); // LatRef inline (<=4 bytes)
    push(Buffer.concat([u16(0x0002), u16(5), u32(3), u32(gpsValuesStart)])); // Latitude
    push(Buffer.concat([u16(0x0003), u16(2), u32(2), Buffer.from(g.lngRef + '\0', 'ascii'), Buffer.alloc(2)])); // LngRef inline
    push(Buffer.concat([u16(0x0004), u16(5), u32(3), u32(gpsValuesStart + 24)])); // Longitude
    push(u32(0));
    push(Buffer.concat([rational(g.latDms[0], 1), rational(g.latDms[1], 1), rational(g.latDms[2], 1)]));
    push(Buffer.concat([rational(g.lngDms[0], 1), rational(g.lngDms[1], 1), rational(g.lngDms[2], 1)]));
  }

  const tiff = Buffer.concat(chunks);
  const app1Body = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff]);
  const app1Size = app1Body.length + 2;
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1, (app1Size >> 8) & 0xff, app1Size & 0xff]),
    app1Body,
    Buffer.from([0xff, 0xd9]),
  ]);
  return jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength);
};

describe('exifCapture — web JPEG reader', () => {
  it('reads DateTimeOriginal as a naive local ISO string', () => {
    const meta = readImageCaptureMetadataFromBuffer(buildJpegExif({ date: '2026:09:01 14:30:00' }));
    expect(meta.capturedAt).toBe('2026-09-01T14:30:00');
  });

  it('reads GPS latitude/longitude with hemisphere sign', () => {
    const meta = readImageCaptureMetadataFromBuffer(buildJpegExif({
      date: '2026:09:01 09:00:00',
      gps: { latDms: [48, 51, 30], latRef: 'N', lngDms: [2, 21, 0], lngRef: 'E' },
    }));
    expect(meta.capturedLat).toBeCloseTo(48.8583, 3);
    expect(meta.capturedLng).toBeCloseTo(2.35, 3);
  });

  it('applies S/W as negative', () => {
    const meta = readImageCaptureMetadataFromBuffer(buildJpegExif({
      gps: { latDms: [33, 52, 0], latRef: 'S', lngDms: [151, 12, 0], lngRef: 'E' },
    }));
    expect(meta.capturedLat).toBeLessThan(0);
    expect(meta.capturedLng).toBeGreaterThan(0);
  });

  it('returns {} for a non-JPEG buffer', () => {
    expect(readImageCaptureMetadataFromBuffer(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toEqual({});
  });

  it('returns {} for a JPEG with no Exif segment', () => {
    const buf = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]).buffer;
    expect(readImageCaptureMetadataFromBuffer(buf)).toEqual({});
  });
});

describe('exifCapture — native expo-image-picker exif', () => {
  it('handles the iOS nested {Exif}/{GPS} shape', () => {
    const meta = readNativeExifCapture({
      '{Exif}': { DateTimeOriginal: '2026:07:04 18:05:11' },
      '{GPS}': { Latitude: 40.7128, LatitudeRef: 'N', Longitude: 74.006, LongitudeRef: 'W' },
    });
    expect(meta.capturedAt).toBe('2026-07-04T18:05:11');
    expect(meta.capturedLat).toBeCloseTo(40.7128, 3);
    expect(meta.capturedLng).toBeCloseTo(-74.006, 3);
  });

  it('handles the Android flat shape', () => {
    const meta = readNativeExifCapture({ DateTimeOriginal: '2026:07:04 18:05:11', GPSLatitude: 1.23, GPSLatitudeRef: 'N', GPSLongitude: 4.56, GPSLongitudeRef: 'E' });
    expect(meta.capturedAt).toBe('2026-07-04T18:05:11');
    expect(meta.capturedLat).toBeCloseTo(1.23, 2);
  });

  it('returns {} when exif is null or empty', () => {
    expect(readNativeExifCapture(null)).toEqual({});
    expect(readNativeExifCapture({})).toEqual({});
  });

  it('ignores a 0/0 GPS fix but keeps the date', () => {
    const meta = readNativeExifCapture({ DateTimeOriginal: '2026:01:02 03:04:05', GPSLatitude: 0, GPSLongitude: 0 });
    expect(meta.capturedAt).toBe('2026-01-02T03:04:05');
    expect(meta.capturedLat).toBeUndefined();
  });
});
