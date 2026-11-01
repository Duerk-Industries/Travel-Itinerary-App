/// <reference types="jest" />
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

jest.mock('../src/apis/commonsApi', () => ({ searchCommonsPictures: jest.fn(), downloadCandidateThumbnail: jest.fn() }));
jest.mock('../src/apis/pictureReviewApi', () => ({ reviewPictures: jest.fn() }));

import { downloadCandidateThumbnail, searchCommonsPictures, type CommonsCandidate } from '../src/apis/commonsApi';
import { reviewPictures } from '../src/apis/pictureReviewApi';
import { closePool, initDb, listTripTemplateImports } from '../src/db';
import { distinctiveWords, fillMissingTemplatePictures, findTemplatePicture, queueTemplatePictureLookup, reviewPool } from '../src/services/templatePictureService';
import { importBundle } from '../src/services/tripTemplateBundle';
import { clearTripTemplateCacheForTests, refreshImportedTemplates } from '../src/services/tripTemplateService';
import { clearTripTemplateMediaCacheForTests, getTemplateDestination, getTemplatePlace } from '../src/services/tripTemplateMedia';

const search = searchCommonsPictures as jest.Mock;
const download = downloadCandidateThumbnail as jest.Mock;
const review = reviewPictures as jest.Mock;

const candidate = (title: string, overrides: Partial<CommonsCandidate> = {}): CommonsCandidate => ({
  title: `File:${title}.jpg`, url: `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/${title.replace(/ /g, '_')}.jpg/960px-${title.replace(/ /g, '_')}.jpg`,
  width: 960, height: 640, pageUrl: `https://commons.wikimedia.org/wiki/File:${title.replace(/ /g, '_')}.jpg`, license: 'CC0', author: 'Ada Lovelace', description: '', ...overrides,
});

const example = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/trip-template-authoring/example-bundle.json'), 'utf8'));
const PLACE = 'portugal/belem-tower';
const CITY = 'portugal/lisbon';

describe('pictures found for imported template stops', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    clearTripTemplateCacheForTests();
    clearTripTemplateMediaCacheForTests();
    const report = await importBundle(example(), { dryRun: false, importedBy: null });
    expect(report.applied).toBe(true);
    await refreshImportedTemplates(true);
  });

  beforeEach(() => {
    search.mockReset();
    download.mockReset();
    review.mockReset();
    download.mockResolvedValue({ data: 'AAAA', mediaType: 'image/jpeg' });
  });

  afterAll(async () => {
    await closePool();
  });

  it('takes the title matches first and tops up with other candidates for the reviewer', () => {
    const words = distinctiveWords('Belém Tower', 'portugal');
    expect(words).toEqual(['belem', 'tower']);
    const pool = reviewPool([candidate('Sunset over the river'), candidate('Belem Tower at dusk'), candidate('Cat sleeping'), candidate('Tower of Belem'), candidate('A crane at dusk')], words);
    expect(pool.map((c) => c.title)).toEqual(['File:Belem Tower at dusk.jpg', 'File:Tower of Belem.jpg', 'File:Sunset over the river.jpg']);
  });

  it('keeps only a picture the reviewer approved with high confidence, tagged as AI-chosen', async () => {
    search.mockResolvedValue([candidate('Belem Tower at dusk'), candidate('Belem Tower interior hall'), candidate('Tower of Belem')]);
    review.mockResolvedValue({ pick: 1, confidence: 'high', reason: 'The tower on the river.' });
    const image = await findTemplatePicture({ name: 'Belém Tower', description: 'A fortified tower.', country: 'portugal', isCountry: false });
    expect(image).toMatchObject({ title: 'File:Belem Tower at dusk.jpg', license: 'CC0', author: 'Ada Lovelace', selection: 'ai' });
    expect(search).toHaveBeenCalledWith('Belém Tower portugal');

    review.mockResolvedValue({ pick: 1, confidence: 'low', reason: 'Could be anywhere.' });
    expect(await findTemplatePicture({ name: 'Belém Tower', description: '', country: 'portugal', isCountry: false })).toBeNull();
    review.mockResolvedValue({ pick: null, confidence: 'high', reason: 'None show it.' });
    expect(await findTemplatePicture({ name: 'Belém Tower', description: '', country: 'portugal', isCountry: false })).toBeNull();
  });

  it('never keeps a picture that is not a public-domain or CC0 Wikimedia file, whatever the search returned', async () => {
    review.mockResolvedValue({ pick: 1, confidence: 'high', reason: 'Fine.' });
    search.mockResolvedValue([candidate('Belem Tower', { license: 'CC BY-SA 4.0' })]);
    expect(await findTemplatePicture({ name: 'Belém Tower', description: '', country: 'portugal', isCountry: false })).toBeNull();
    search.mockResolvedValue([candidate('Belem Tower', { url: 'https://example.com/belem.jpg' })]);
    expect(await findTemplatePicture({ name: 'Belém Tower', description: '', country: 'portugal', isCountry: false })).toBeNull();
  });

  it('adds approved pictures to the imported stop and city, saved so every instance sees them, and does not search again', async () => {
    expect(getTemplatePlace(PLACE)?.image).toBeNull();
    expect(getTemplateDestination(CITY)?.images).toEqual([]);
    search.mockImplementation(async (query: string) => (query.startsWith('Lisbon') ? [candidate('Lisbon skyline')] : [candidate('Belem Tower at dusk')]));
    review.mockResolvedValue({ pick: 1, confidence: 'high', reason: 'Clearly the place.' });

    const added = await fillMissingTemplatePictures([{ kind: 'place', key: PLACE }, { kind: 'destination', key: CITY }], null);
    expect(added).toBe(2);
    expect(getTemplatePlace(PLACE)?.image).toMatchObject({ title: 'File:Belem Tower at dusk.jpg', selection: 'ai' });
    expect(getTemplateDestination(CITY)?.images[0]).toMatchObject({ title: 'File:Lisbon skyline.jpg', selection: 'ai' });
    const rows = await listTripTemplateImports();
    expect((rows.find((row) => row.kind === 'place' && row.key === PLACE)?.payload as any).image.selection).toBe('ai');

    search.mockClear();
    expect(await fillMissingTemplatePictures([{ kind: 'place', key: PLACE }, { kind: 'destination', key: CITY }], null)).toBe(0);
    expect(search).not.toHaveBeenCalled();
  });

  it('remembers a stop that got no picture, so re-importing the same bundle costs nothing', async () => {
    const other = 'portugal/pasteis-de-belem';
    expect(getTemplatePlace(other)?.image).toBeNull();
    search.mockResolvedValue([candidate('Custard tarts in a box')]);
    review.mockResolvedValue({ pick: null, confidence: 'high', reason: 'Not the place.' });
    expect(await fillMissingTemplatePictures([{ kind: 'place', key: other }], null)).toBe(0);
    expect(await fillMissingTemplatePictures([{ kind: 'place', key: other }], null)).toBe(0);
    expect(search).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledTimes(1);
  });

  it('does nothing after an import unless lookups are switched on, and never during tests by default', async () => {
    expect(await queueTemplatePictureLookup([{ kind: 'place', key: PLACE }], null)).toBe(0);
    expect(search).not.toHaveBeenCalled();
  });
});
