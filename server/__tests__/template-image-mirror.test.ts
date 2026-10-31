/// <reference types="jest" />
/// <reference types="node" />
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import request from 'supertest';

const files = new Map<string, { data: Buffer; options: any }>();
jest.mock('@google-cloud/storage', () => ({
  Storage: class {
    bucket() {
      return {
        getFiles: async ({ prefix }: { prefix: string }) => [[...files.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name }))],
        file: (name: string) => ({
          save: async (data: Buffer, options: any) => { files.set(name, { data, options }); },
          exists: async () => [files.has(name)],
          getMetadata: async () => [{ contentType: files.get(name)?.options.contentType, size: files.get(name)?.data.length }],
          createReadStream: () => Readable.from([files.get(name)!.data]),
        }),
      };
    }
  },
}));

import axios from 'axios';
import { app } from '../src/app';
import {
  allTemplateImages, clearTripTemplateMediaCacheForTests, isMirrorKey, setImportedTemplateMedia, setMirroredTemplateImages, templateImageKey, toPublicImage,
  type TemplateImage,
} from '../src/services/tripTemplateMedia';
import { resetTemplateImageMirrorForTests, syncTemplateImageMirror } from '../src/services/templateImageMirrorService';

const get = jest.spyOn(axios, 'get') as unknown as jest.Mock;
const picture = (name: string, overrides: Partial<TemplateImage> = {}): TemplateImage => ({
  url: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${name}.jpg/640px-${name}.jpg`, width: 640, height: 480, title: name,
  pageUrl: `https://commons.wikimedia.org/wiki/File:${name}.jpg`, license: 'Public domain', author: 'Ada Lovelace', ...overrides,
});
const place = (image: TemplateImage) => ({ name: 'Somewhere', description: '', details: '', interests: [], image });
const jpeg = (bytes = 'jpegbytes') => ({ data: Buffer.from(bytes), headers: { 'content-type': 'image/jpeg' } });

describe('copies of public-domain template pictures', () => {
  const previousBackend = process.env.BACKEND_URL;
  const previousTemplates = process.env.TRIP_TEMPLATES_DIR;
  // An empty catalogue, so only the pictures a test imports are in play.
  const emptyCatalogue = fs.mkdtempSync(path.join(os.tmpdir(), 'no-templates-'));

  beforeEach(() => {
    process.env.BACKEND_URL = 'https://trips.example';
    process.env.TRIP_TEMPLATES_DIR = emptyCatalogue;
    files.clear();
    get.mockReset();
    resetTemplateImageMirrorForTests();
    clearTripTemplateMediaCacheForTests();
    setMirroredTemplateImages([]);
  });

  afterAll(() => {
    if (previousBackend === undefined) delete process.env.BACKEND_URL; else process.env.BACKEND_URL = previousBackend;
    if (previousTemplates === undefined) delete process.env.TRIP_TEMPLATES_DIR; else process.env.TRIP_TEMPLATES_DIR = previousTemplates;
    fs.rmSync(emptyCatalogue, { recursive: true, force: true });
    clearTripTemplateMediaCacheForTests();
  });

  it('names a copy by a hash of the Wikimedia address and keeps the file type', () => {
    const url = picture('Bridge').url;
    expect(templateImageKey(url)).toMatch(/^[a-f0-9]{40}\.jpg$/);
    expect(templateImageKey(url)).toBe(templateImageKey(url));
    expect(templateImageKey('https://upload.wikimedia.org/x/Map.PNG')).toMatch(/\.png$/);
    expect(isMirrorKey(templateImageKey(url))).toBe(true);
    expect(isMirrorKey('../secrets.txt')).toBe(false);
  });

  it('serves a picture from our domain once its copy exists, with the credit unchanged, and from Wikimedia before', () => {
    const image = picture('Bridge');
    expect(toPublicImage(image)).toMatchObject({ url: image.url, credit: 'Ada Lovelace, Public domain', pageUrl: image.pageUrl });
    setMirroredTemplateImages([templateImageKey(image.url)]);
    expect(toPublicImage(image)).toMatchObject({ url: `https://trips.example/api/template-images/${templateImageKey(image.url)}`, credit: 'Ada Lovelace, Public domain', pageUrl: image.pageUrl });
  });

  it('copies each missing public-domain picture once, with its license and author, and skips the rest', async () => {
    const good = picture('Bridge');
    const copied = picture('Tower', { license: 'CC0' });
    const wrongLicense = picture('Logo', { license: 'CC BY-SA 4.0' });
    const wrongHost = picture('Elsewhere', { url: 'https://example.com/photo.jpg' });
    const notAnImage = picture('Page');
    const places = new Map([['a/good', place(good)], ['a/copied', place(copied)], ['a/license', place(wrongLicense)], ['a/host', place(wrongHost)], ['a/page', place(notAnImage)]]);
    setImportedTemplateMedia(places as any, new Map());
    expect(allTemplateImages()).toEqual(expect.arrayContaining([good, copied, wrongLicense, wrongHost, notAnImage]));
    files.set(`template-images/${templateImageKey(copied.url)}`, { data: Buffer.from('already'), options: { contentType: 'image/jpeg' } });
    get.mockImplementation(async (url: string) => (url === notAnImage.url ? { data: Buffer.from('<html>'), headers: { 'content-type': 'text/html' } } : jpeg()));

    expect(await syncTemplateImageMirror({ pauseMs: 0 })).toBe(1) // the HTML page is refused, the CC BY-SA and non-Wikimedia ones are never fetched;
    const saved = files.get(`template-images/${templateImageKey(good.url)}`);
    expect(saved?.data.toString()).toBe('jpegbytes');
    expect(saved?.options).toMatchObject({ contentType: 'image/jpeg', metadata: { cacheControl: 'public, max-age=31536000, immutable', metadata: { license: 'Public domain', author: 'Ada Lovelace', pageUrl: good.pageUrl, sourceUrl: good.url } } });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).not.toHaveBeenCalledWith(wrongLicense.url, expect.anything());
    expect(get).not.toHaveBeenCalledWith(wrongHost.url, expect.anything());
    expect(get.mock.calls[0][1].headers['User-Agent']).toContain('Wikimedia Commons');
    expect(toPublicImage(good)?.url).toContain('/api/template-images/');
    expect(toPublicImage(copied)?.url).toContain('/api/template-images/');
    expect(toPublicImage(notAnImage)?.url).toBe(notAnImage.url);

    get.mockClear();
    await syncTemplateImageMirror({ pauseMs: 0 });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('serves a copy publicly, long-cached, and refuses anything that is not a copy', async () => {
    const image = picture('Bridge');
    setImportedTemplateMedia(new Map([['a/good', place(image)]]) as any, new Map());
    get.mockResolvedValue(jpeg('PICTURE'));
    await syncTemplateImageMirror({ pauseMs: 0 });
    const key = templateImageKey(image.url);

    const res = await request(app).get(`/api/template-images/${key}`).buffer(true).parse((r, done) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => done(null, Buffer.concat(chunks))); }).expect(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((res.body as Buffer).toString()).toBe('PICTURE');
    await request(app).get(`/api/template-images/${'0'.repeat(40)}.jpg`).expect(404);
    await request(app).get('/api/template-images/not-a-key').expect(404);
  });
});
