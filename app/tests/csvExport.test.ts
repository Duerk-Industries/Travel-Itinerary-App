/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';

describe('exportCsv (web)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
  });

  it('triggers a browser download via Blob + anchor and returns "downloaded"', async () => {
    const click = jest.fn();
    const link: any = { click, href: '', download: '' };
    const createElementSpy = jest
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => (tag === 'a' ? link : (document.createElement.bind(document) as any)(tag)));
    const createObjectURL = jest.fn(() => 'blob:dummy');
    const revokeObjectURL = jest.fn();
    (global as any).URL.createObjectURL = createObjectURL;
    (global as any).URL.revokeObjectURL = revokeObjectURL;

    const { exportCsv } = require('../utils/csvExport');
    await expect(exportCsv('a,b\n1,2', 'trip.csv')).resolves.toBe('downloaded');
    expect(link.download).toBe('trip.csv');
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:dummy');
    createElementSpy.mockRestore();
  });
});

describe('exportCsv (native, new File API)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
  });

  const buildFileSystemMock = (
    overrides: {
      createFail?: boolean;
      writeFail?: boolean;
      withoutPathsCache?: boolean;
      withoutFileClass?: boolean;
    } = {},
  ) => {
    const createSpy = jest.fn((_opts: unknown) => {
      if (overrides.createFail) throw new Error('create failed');
    });
    const writeSpy = jest.fn((_content: string, _opts: unknown) => {
      if (overrides.writeFail) throw new Error('write failed');
    });
    const constructorSpy = jest.fn();

    class FakeFile {
      uri: string;
      constructor(...args: any[]) {
        constructorSpy(...args);
        const tail = args[args.length - 1];
        this.uri = `file:///cache/${String(tail)}`;
      }
      create = createSpy;
      write = writeSpy;
    }

    const cacheDir = { uri: 'file:///cache/' };
    return {
      module: {
        Paths: overrides.withoutPathsCache ? {} : { cache: cacheDir },
        File: overrides.withoutFileClass ? undefined : FakeFile,
      },
      createSpy,
      writeSpy,
      constructorSpy,
    };
  };

  it('writes via new File(Paths.cache, name).create() + .write() and opens the share sheet', async () => {
    const fs = buildFileSystemMock();
    const shareAsync = jest.fn<(uri: string, opts?: any) => Promise<void>>().mockResolvedValue(undefined);
    const isAvailableAsync = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);

    jest.doMock('expo-file-system', () => fs.module, { virtual: true });
    jest.doMock('expo-sharing', () => ({ isAvailableAsync, shareAsync }), { virtual: true });

    const { exportCsv } = require('../utils/csvExport');
    await expect(exportCsv('a,b\n1,2', 'trip 1.csv')).resolves.toBe('shared');
    expect(fs.constructorSpy).toHaveBeenCalledWith({ uri: 'file:///cache/' }, 'trip_1.csv');
    expect(fs.createSpy).toHaveBeenCalledWith(expect.objectContaining({ overwrite: true }));
    expect(fs.writeSpy).toHaveBeenCalledWith('a,b\n1,2', expect.objectContaining({ encoding: 'utf8' }));
    expect(shareAsync).toHaveBeenCalledWith(
      'file:///cache/trip_1.csv',
      expect.objectContaining({ mimeType: 'text/csv' }),
    );
  });

  it('returns "unavailable" if Sharing.isAvailableAsync resolves false', async () => {
    const fs = buildFileSystemMock();
    jest.doMock('expo-file-system', () => fs.module, { virtual: true });
    jest.doMock(
      'expo-sharing',
      () => ({
        isAvailableAsync: jest.fn<() => Promise<boolean>>().mockResolvedValue(false),
        shareAsync: jest.fn<(uri: string, opts?: any) => Promise<void>>().mockResolvedValue(undefined),
      }),
      { virtual: true },
    );

    const { exportCsv } = require('../utils/csvExport');
    await expect(exportCsv('a', 'x.csv')).resolves.toBe('unavailable');
  });

  it('returns "unavailable" if Paths.cache is missing (older module shape)', async () => {
    const fs = buildFileSystemMock({ withoutPathsCache: true });
    jest.doMock('expo-file-system', () => fs.module, { virtual: true });
    jest.doMock(
      'expo-sharing',
      () => ({
        isAvailableAsync: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
        shareAsync: jest.fn<(uri: string, opts?: any) => Promise<void>>().mockResolvedValue(undefined),
      }),
      { virtual: true },
    );

    const { exportCsv } = require('../utils/csvExport');
    await expect(exportCsv('a', 'x.csv')).resolves.toBe('unavailable');
  });

  it('returns "failed" if File.write throws', async () => {
    const fs = buildFileSystemMock({ writeFail: true });
    jest.doMock('expo-file-system', () => fs.module, { virtual: true });
    jest.doMock(
      'expo-sharing',
      () => ({
        isAvailableAsync: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
        shareAsync: jest.fn<(uri: string, opts?: any) => Promise<void>>().mockResolvedValue(undefined),
      }),
      { virtual: true },
    );

    const { exportCsv } = require('../utils/csvExport');
    await expect(exportCsv('a', 'x.csv')).resolves.toBe('failed');
  });

  it('does NOT touch the deprecated writeAsStringAsync / cacheDirectory legacy API', async () => {
    const writeAsStringAsync = jest.fn(() => {
      throw new Error('legacy API should not be called');
    });
    const fs = buildFileSystemMock();
    jest.doMock(
      'expo-file-system',
      () => ({
        ...fs.module,
        // Legacy helpers that throw at runtime in v19; if csvExport falls back
        // to them, the test fails.
        cacheDirectory: 'file:///cache/',
        EncodingType: { UTF8: 'utf8' },
        writeAsStringAsync,
      }),
      { virtual: true },
    );
    jest.doMock(
      'expo-sharing',
      () => ({
        isAvailableAsync: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
        shareAsync: jest.fn<(uri: string, opts?: any) => Promise<void>>().mockResolvedValue(undefined),
      }),
      { virtual: true },
    );

    const { exportCsv } = require('../utils/csvExport');
    await expect(exportCsv('a', 'y.csv')).resolves.toBe('shared');
    expect(writeAsStringAsync).not.toHaveBeenCalled();
    expect(fs.writeSpy).toHaveBeenCalled();
  });
});
