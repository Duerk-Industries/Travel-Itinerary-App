import { shouldSample } from '../src/utils/sampleRate';

describe('shouldSample', () => {
  it('always samples at 100%', () => {
    expect(shouldSample(100, 0)).toBe(true);
    expect(shouldSample(100, 0.999999)).toBe(true);
  });

  it('never samples at 0%', () => {
    expect(shouldSample(0, 0)).toBe(false);
    expect(shouldSample(0, 0.5)).toBe(false);
  });

  it('samples based on where randomValue falls relative to the percent threshold', () => {
    expect(shouldSample(50, 0.1)).toBe(true);
    expect(shouldSample(50, 0.9)).toBe(false);
  });

  it('clamps out-of-range percentages into [0, 100] instead of misbehaving', () => {
    expect(shouldSample(150, 0.99)).toBe(true); // clamped to 100
    expect(shouldSample(-20, 0.01)).toBe(false); // clamped to 0
  });
});
