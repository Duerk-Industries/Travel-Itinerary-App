/// <reference types="jest" />
/// <reference types="node" />
import { computePlaceMatchLikelihood } from '../src/image-service';

describe('computePlaceMatchLikelihood', () => {
  it('returns high likelihood for identical names', () => {
    const score = computePlaceMatchLikelihood('Frida Kahlo Museum', 'Frida Kahlo Museum');
    expect(score).toBeGreaterThanOrEqual(0.75);
  });

  it('returns low likelihood for unrelated names', () => {
    const score = computePlaceMatchLikelihood('Frida Kahlo Museum', 'Tokyo Tower');
    expect(score).toBeLessThan(0.5);
  });

  it('ignores common stopwords', () => {
    const score = computePlaceMatchLikelihood('The Museum of Anthropology', 'Museum Anthropology');
    expect(score).toBeGreaterThanOrEqual(0.75);
  });
});
