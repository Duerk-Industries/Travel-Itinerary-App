// Slice 1 of the photo-first composer (A2) — the client is the only place a photo's capture time
// and location can be read (architecture §8/§14.7: "the server never parses EXIF itself"). The
// composer buckets photos by capture day, and the day-facts time-span chip reads the same field;
// without this every asset's captured_at is NULL and every photo lands in "Unassigned".
//
// Native goes through expo-image-picker's own `exif: true` output (see readNativeExifCapture).
// Web has no picker EXIF, so this is a deliberately small JPEG APP1/Exif reader — enough for
// DateTimeOriginal and the GPS IFD, nothing more. Any parse failure returns {} and the upload
// proceeds exactly as it does today.

export type CaptureMetadata = {
  capturedAt?: string;
  capturedLat?: number;
  capturedLng?: number;
};

// EXIF DateTimeOriginal is "YYYY:MM:DD HH:MM:SS" with no zone. Keep it as a naive local wall-clock
// ISO string ("YYYY-MM-DDTHH:MM:SS") — the server buckets against the trip's own calendar days.
const exifDateToIso = (raw: string): string | undefined => {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(raw).trim());
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
};

// GPS coordinates are three RATIONALs (degrees, minutes, seconds) plus a N/S/E/W ref.
const dmsToDecimal = (dms: [number, number, number], ref: string): number | undefined => {
  if (!dms || dms.some((n) => !Number.isFinite(n))) return undefined;
  const decimal = dms[0] + dms[1] / 60 + dms[2] / 3600;
  if (!Number.isFinite(decimal)) return undefined;
  return /[SW]/i.test(ref) ? -decimal : decimal;
};

// --- Web: minimal JPEG Exif reader -----------------------------------------------------------

const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_GPS_IFD_POINTER = 0x8825;
const TAG_GPS_LAT_REF = 0x0001;
const TAG_GPS_LAT = 0x0002;
const TAG_GPS_LNG_REF = 0x0003;
const TAG_GPS_LNG = 0x0004;

type Reader = { u16: (o: number) => number; u32: (o: number) => number; le: boolean };

const readAscii = (view: DataView, offset: number, count: number): string => {
  let out = '';
  for (let i = 0; i < count; i += 1) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
};

const readRationals = (view: DataView, r: Reader, offset: number, count: number): number[] => {
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const num = r.u32(offset + i * 8);
    const den = r.u32(offset + i * 8 + 4);
    values.push(den === 0 ? 0 : num / den);
  }
  return values;
};

// Walk one IFD, returning { tag -> {type, count, valueOffset} }. `tiffStart` is the base every
// offset in the Exif block is relative to.
const parseIfd = (view: DataView, r: Reader, tiffStart: number, ifdOffset: number): Map<number, { type: number; count: number; valueOffset: number }> => {
  const entries = new Map<number, { type: number; count: number; valueOffset: number }>();
  const count = r.u16(tiffStart + ifdOffset);
  for (let i = 0; i < count; i += 1) {
    const entry = tiffStart + ifdOffset + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = r.u16(entry);
    const type = r.u16(entry + 2);
    const valueCount = r.u32(entry + 4);
    const typeSize = type === 1 || type === 2 || type === 7 ? 1 : type === 3 ? 2 : type === 4 || type === 9 ? 4 : 8;
    const byteLength = typeSize * valueCount;
    const valueOffset = byteLength <= 4 ? entry + 8 : tiffStart + r.u32(entry + 8);
    entries.set(tag, { type, count: valueCount, valueOffset });
  }
  return entries;
};

const readGps = (view: DataView, r: Reader, tiffStart: number, gpsIfdOffset: number): { lat?: number; lng?: number } => {
  const gps = parseIfd(view, r, tiffStart, gpsIfdOffset);
  const latEntry = gps.get(TAG_GPS_LAT);
  const lngEntry = gps.get(TAG_GPS_LNG);
  const latRef = gps.get(TAG_GPS_LAT_REF);
  const lngRef = gps.get(TAG_GPS_LNG_REF);
  const result: { lat?: number; lng?: number } = {};
  if (latEntry && latEntry.count === 3 && latRef) {
    const [d, m, s] = readRationals(view, r, latEntry.valueOffset, 3);
    result.lat = dmsToDecimal([d, m, s], readAscii(view, latRef.valueOffset, latRef.count));
  }
  if (lngEntry && lngEntry.count === 3 && lngRef) {
    const [d, m, s] = readRationals(view, r, lngEntry.valueOffset, 3);
    result.lng = dmsToDecimal([d, m, s], readAscii(view, lngRef.valueOffset, lngRef.count));
  }
  return result;
};

export const readImageCaptureMetadataFromBuffer = (buffer: ArrayBuffer): CaptureMetadata => {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return {}; // not a JPEG

    // Find the APP1 (Exif) segment.
    let offset = 2;
    let app1Start = -1;
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) break;
      const marker = view.getUint8(offset + 1);
      const size = view.getUint16(offset + 2);
      if (marker === 0xe1 && readAscii(view, offset + 4, 4) === 'Exif') {
        app1Start = offset + 4 + 6; // skip "Exif\0\0"
        break;
      }
      if (marker === 0xda) break; // start of scan — no more metadata
      offset += 2 + size;
    }
    if (app1Start < 0) return {};

    const byteOrder = view.getUint16(app1Start);
    const le = byteOrder === 0x4949;
    if (!le && byteOrder !== 0x4d4d) return {};
    const r: Reader = {
      le,
      u16: (o) => view.getUint16(o, le),
      u32: (o) => view.getUint32(o, le),
    };
    const tiffStart = app1Start;
    const ifd0Offset = r.u32(tiffStart + 4);
    const ifd0 = parseIfd(view, r, tiffStart, ifd0Offset);

    const out: CaptureMetadata = {};

    const exifPointer = ifd0.get(TAG_EXIF_IFD_POINTER);
    if (exifPointer) {
      const exifIfd = parseIfd(view, r, tiffStart, r.u32(exifPointer.valueOffset));
      const dto = exifIfd.get(TAG_DATETIME_ORIGINAL);
      if (dto && dto.type === 2) {
        const iso = exifDateToIso(readAscii(view, dto.valueOffset, dto.count));
        if (iso) out.capturedAt = iso;
      }
    }

    const gpsPointer = ifd0.get(TAG_GPS_IFD_POINTER);
    if (gpsPointer) {
      const { lat, lng } = readGps(view, r, tiffStart, r.u32(gpsPointer.valueOffset));
      if (lat != null && lng != null) { out.capturedLat = lat; out.capturedLng = lng; }
    }

    return out;
  } catch {
    return {};
  }
};

export const readImageCaptureMetadata = async (blob: Blob): Promise<CaptureMetadata> => {
  try {
    if (!blob || !/^image\/jpe?g$/i.test(blob.type || '')) return {};
    // Only the first 128 KiB is ever needed — Exif lives in the first APP segment.
    const slice = blob.slice(0, 128 * 1024);
    const buffer = await slice.arrayBuffer();
    return readImageCaptureMetadataFromBuffer(buffer);
  } catch {
    return {};
  }
};

// --- Native: normalize expo-image-picker's exif output ---------------------------------------

// expo-image-picker returns a loosely-typed object whose keys differ by platform (iOS nests under
// "{Exif}" / "{GPS}", Android flattens). Pull what we can, defensively.
export const readNativeExifCapture = (exif: Record<string, any> | null | undefined): CaptureMetadata => {
  if (!exif || typeof exif !== 'object') return {};
  const nestedExif = exif['{Exif}'] ?? exif.Exif ?? exif;
  const nestedGps = exif['{GPS}'] ?? exif.GPS ?? exif;
  const out: CaptureMetadata = {};

  const rawDate = nestedExif?.DateTimeOriginal ?? nestedExif?.DateTimeDigitized ?? exif?.DateTimeOriginal ?? exif?.DateTime;
  if (typeof rawDate === 'string') {
    const iso = exifDateToIso(rawDate);
    if (iso) out.capturedAt = iso;
  }

  const lat = Number(nestedGps?.Latitude ?? nestedGps?.GPSLatitude ?? exif?.GPSLatitude);
  const lng = Number(nestedGps?.Longitude ?? nestedGps?.GPSLongitude ?? exif?.GPSLongitude);
  const latRef = String(nestedGps?.LatitudeRef ?? nestedGps?.GPSLatitudeRef ?? exif?.GPSLatitudeRef ?? 'N');
  const lngRef = String(nestedGps?.LongitudeRef ?? nestedGps?.GPSLongitudeRef ?? exif?.GPSLongitudeRef ?? 'E');
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    out.capturedLat = /S/i.test(latRef) ? -Math.abs(lat) : Math.abs(lat);
    out.capturedLng = /W/i.test(lngRef) ? -Math.abs(lng) : Math.abs(lng);
  }

  return out;
};
