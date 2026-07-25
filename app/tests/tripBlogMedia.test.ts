/// <reference types="jest" />

import { resolveMediaAspectRatio } from '../tabs/tripBlog';

describe('trip blog media sizing', () => {
  it('preserves valid intrinsic width-to-height ratios', () => {
    expect(resolveMediaAspectRatio(4032, 3024)).toBeCloseTo(4 / 3);
    expect(resolveMediaAspectRatio(1080, 1920)).toBeCloseTo(9 / 16);
  });

  it('ignores missing or invalid intrinsic dimensions', () => {
    expect(resolveMediaAspectRatio(0, 1080)).toBeNull();
    expect(resolveMediaAspectRatio(1920, undefined)).toBeNull();
    expect(resolveMediaAspectRatio('not-a-width', 1080)).toBeNull();
  });
});
