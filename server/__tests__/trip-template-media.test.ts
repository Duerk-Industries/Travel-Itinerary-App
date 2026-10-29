/// <reference types="jest" />
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { loadSeedTemplates, buildTemplatePreview, templateDestinations, templateHeroImage } from '../src/services/tripTemplateService';
import { getTemplateDestination, getTemplatePlace } from '../src/services/tripTemplateMedia';

const mediaDir = path.resolve(__dirname, '../data/trip-templates/media');
const mediaFiles = fs.readdirSync(mediaDir).filter((name) => name.endsWith('.json'));
const allImages = () => mediaFiles.flatMap((name) => {
  const file = JSON.parse(fs.readFileSync(path.join(mediaDir, name), 'utf8'));
  return [
    ...Object.values<any>(file.places).flatMap((place) => (place.image ? [place.image] : [])),
    ...Object.values<any>(file.destinations).flatMap((destination) => destination.images),
  ];
});

describe('template media catalogue', () => {
  it('only holds pictures their files declare public domain or CC0, with a credit and a Commons page', () => {
    const images = allImages();
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image.license).toMatch(/^(public domain|cc0|pd)/i);
      expect(image.url).toMatch(/^https:\/\/(upload|thumb)\.wikimedia\.org\//);
      expect(image.url).not.toContain('?');
      expect(image.pageUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(image.author.length).toBeGreaterThan(0);
    }
  });

  it('describes every stop of every template, and the description is shared, not copied per template', () => {
    const templates = loadSeedTemplates();
    const used = new Map<string, number>();
    for (const template of templates) {
      for (const activity of template.activities) {
        expect(activity.place).not.toBe('');
        const place = getTemplatePlace(activity.place);
        expect(place?.description.length).toBeGreaterThan(20);
        used.set(activity.place, (used.get(activity.place) ?? 0) + 1);
      }
      // Descriptions live in the catalogue only; the template file carries just the key.
      expect(JSON.stringify(template)).not.toContain('"description"');
    }
    expect([...used.values()].some((count) => count > 1)).toBe(true);
  });

  it('describes and pictures every destination a template names, and gives each card a hero picture', () => {
    for (const template of loadSeedTemplates()) {
      for (const key of template.destinationKeys) {
        expect(getTemplateDestination(key)?.description.length).toBeGreaterThan(20);
      }
      expect(templateDestinations(template).length).toBe(template.destinationKeys.length);
      expect(templateHeroImage(template)?.url).toMatch(/^https:\/\//);
    }
  });

  it('puts the description and picture on the preview item for a stop', () => {
    const template = loadSeedTemplates().find((t) => t.activities.some((a) => a.place === 'japan/fushimi-inari'))!;
    const item = buildTemplatePreview(template).flatMap((day) => day.items).find((i) => i.title.startsWith('Fushimi Inari'))!;
    expect(item.description).toMatch(/torii/i);
    expect(item.image?.credit).toMatch(/,/);
  });
});
