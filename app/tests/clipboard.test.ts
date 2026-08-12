/**
 * @jest-environment jsdom
 */
/// <reference types="node" />

import { jest } from '@jest/globals';
import { parseClipboardMatrix, resolveMemberClipboardValue, serializeClipboardMatrix } from '../utils/clipboardGrid';

describe('activity grid clipboard matrix', () => {
  it('round-trips quoted tabs, newlines, and multiple rows', () => {
    const matrix = [['Museum', 'unused'], ['Cafe\twith tab', 'second line\ncontinued']];
    const text = serializeClipboardMatrix(matrix);
    expect(parseClipboardMatrix(text)).toEqual({
      ok: true,
      value: matrix,
    });
  });

  it('resolves pasted traveler labels and rejects unknown members', () => {
    const members = [
      { id: 'u1', label: 'Bryan Duerk', email: 'bryan@example.com' },
      { id: 'u2', label: 'Tristan Duerk', email: 'tristan@example.com' },
    ];
    expect(resolveMemberClipboardValue('Bryan Duerk; tristan@example.com', members)).toEqual({ ok: true, value: ['u1', 'u2'] });
    expect(resolveMemberClipboardValue('Unknown Person', members).ok).toBe(false);
  });
});

describe('copyToClipboard (web)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
  });

  afterEach(() => {
    // remove the writeText mock we set on navigator.clipboard
    try {
      delete (navigator as any).clipboard;
    } catch {
      // ignore
    }
  });

  it('returns "copied" when navigator.clipboard.writeText succeeds', async () => {
    const writeText = jest.fn<(t: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const { copyToClipboard } = require('../utils/clipboard');
    await expect(copyToClipboard('hello')).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('returns "failed" when writeText rejects (web)', async () => {
    const writeText = jest.fn<(t: string) => Promise<void>>().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const { copyToClipboard } = require('../utils/clipboard');
    await expect(copyToClipboard('hello')).resolves.toBe('failed');
  });

  it('returns "unavailable" when navigator.clipboard is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
    const { copyToClipboard } = require('../utils/clipboard');
    await expect(copyToClipboard('hello')).resolves.toBe('unavailable');
  });

  it('returns "failed" on empty string', async () => {
    const { copyToClipboard } = require('../utils/clipboard');
    await expect(copyToClipboard('')).resolves.toBe('failed');
  });
});

describe('copyToClipboard (native)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
  });

  it('delegates to expo-clipboard.setStringAsync on native', async () => {
    const setStringAsync = jest.fn<(t: string) => Promise<void>>().mockResolvedValue(undefined);
    jest.doMock('expo-clipboard', () => ({ setStringAsync }), { virtual: true });
    const { copyToClipboard } = require('../utils/clipboard');
    await expect(copyToClipboard('hello-native')).resolves.toBe('copied');
    expect(setStringAsync).toHaveBeenCalledWith('hello-native');
  });

  it('returns "failed" when expo-clipboard rejects', async () => {
    const setStringAsync = jest.fn<(t: string) => Promise<void>>().mockRejectedValue(new Error('boom'));
    jest.doMock('expo-clipboard', () => ({ setStringAsync }), { virtual: true });
    const { copyToClipboard } = require('../utils/clipboard');
    await expect(copyToClipboard('x')).resolves.toBe('failed');
  });
});
