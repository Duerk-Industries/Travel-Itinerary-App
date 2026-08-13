'use strict';

const fs = require('node:fs');

const MAX_INPUT_SIZE = 512 * 1024;
const disabledTypes = new Set();
let filesystemDisabled = false;

const fail = (type) => {
  throw new TypeError(`unsupported or disabled file type: ${type || 'unknown'}`);
};

const result = (width, height, type) => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    fail(type);
  }
  if (disabledTypes.has(type)) fail(type);
  return { width, height, type };
};

const readUInt24LE = (input, offset) =>
  input[offset] | (input[offset + 1] << 8) | (input[offset + 2] << 16);

const readJpeg = (input) => {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < input.length) {
    if (input[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < input.length && input[offset] === 0xff) offset += 1;
    const marker = input[offset++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) break;
    if (offset + 1 >= input.length) break;
    const length = input.readUInt16BE(offset);
    if (length < 2 || offset + length > input.length) break;
    const isFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isFrame && length >= 7) {
      return result(input.readUInt16BE(offset + 5), input.readUInt16BE(offset + 3), 'jpg');
    }
    offset += length;
  }
  return null;
};

const readSvg = (input) => {
  const text = input.toString('utf8').slice(0, 128 * 1024);
  if (!/<svg(?:\s|>)/i.test(text)) return null;
  const readAttribute = (name) => {
    const match = text.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
    return match ? Number.parseFloat(match[1]) : undefined;
  };
  let width = readAttribute('width');
  let height = readAttribute('height');
  const viewBox = text.match(/\bviewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
  if ((!width || !height) && viewBox) {
    width = Number.parseFloat(viewBox[1]);
    height = Number.parseFloat(viewBox[2]);
  }
  return width && height ? result(width, height, 'svg') : null;
};

const readTiff = (input) => {
  if (input.length < 10) return null;
  const littleEndian = input[0] === 0x49 && input[1] === 0x49;
  const bigEndian = input[0] === 0x4d && input[1] === 0x4d;
  if (!littleEndian && !bigEndian) return null;
  const read16 = littleEndian ? input.readUInt16LE.bind(input) : input.readUInt16BE.bind(input);
  const read32 = littleEndian ? input.readUInt32LE.bind(input) : input.readUInt32BE.bind(input);
  if (read16(2) !== 42) return null;
  const ifd = read32(4);
  if (ifd + 2 > input.length) return null;
  const count = read16(ifd);
  let width;
  let height;
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > input.length) break;
    const tag = read16(entry);
    const type = read16(entry + 2);
    const valueCount = read32(entry + 4);
    const valueOffset = entry + 8;
    const readValue = () => {
      if (type === 3 && valueCount === 1) return read16(valueOffset);
      if (type === 4 && valueCount === 1) return read32(valueOffset);
      const offset = read32(valueOffset);
      if (offset + 4 > input.length) return undefined;
      return type === 3 ? read16(offset) : read32(offset);
    };
    if (tag === 256) width = readValue();
    if (tag === 257) height = readValue();
  }
  return width && height ? result(width, height, 'tiff') : null;
};

const detect = (input) => {
  if (input.length >= 24 && input.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'binary'))) {
    return result(input.readUInt32BE(16), input.readUInt32BE(20), 'png');
  }
  if (input.length >= 10 && input.subarray(0, 3).toString() === 'GIF') {
    return result(input.readUInt16LE(6), input.readUInt16LE(8), 'gif');
  }
  if (input.length >= 26 && input.subarray(0, 2).toString() === 'BM') {
    return result(Math.abs(input.readInt32LE(18)), Math.abs(input.readInt32LE(22)), 'bmp');
  }
  if (input.length >= 30 && input.subarray(0, 4).toString() === 'RIFF' && input.subarray(8, 12).toString() === 'WEBP') {
    const format = input.subarray(12, 16).toString();
    if (format === 'VP8X' && input.length >= 30) {
      return result(readUInt24LE(input, 24) + 1, readUInt24LE(input, 27) + 1, 'webp');
    }
    if (format === 'VP8 ' && input.length >= 30) {
      return result(input.readUInt16LE(26) & 0x3fff, input.readUInt16LE(28) & 0x3fff, 'webp');
    }
  }
  if (input.length >= 26 && input.subarray(0, 4).toString() === '8BPS') {
    return result(input.readUInt32BE(18), input.readUInt32BE(14), 'psd');
  }
  return readJpeg(input) || readTiff(input) || readSvg(input) || fail();
};

function imageSize(input) {
  let buffer = input;
  if (typeof input === 'string') {
    if (filesystemDisabled) throw new TypeError('filesystem access is disabled');
    buffer = fs.readFileSync(input).subarray(0, MAX_INPUT_SIZE);
  }
  if (!(buffer instanceof Uint8Array) || buffer.length === 0) {
    throw new TypeError('input must be a non-empty Uint8Array or file path');
  }
  return detect(Buffer.from(buffer));
}

module.exports = imageSize;
module.exports.default = imageSize;
module.exports.imageSize = imageSize;
module.exports.types = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'psd', 'svg', 'tiff'];
module.exports.disableFS = (disabled) => { filesystemDisabled = Boolean(disabled); };
module.exports.disableTypes = (types) => { disabledTypes.clear(); for (const type of types || []) disabledTypes.add(type); };
module.exports.setConcurrency = () => {};
