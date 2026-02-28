import {
  isAppearancePreference,
  loadStoredAppearancePreference,
  persistAppearancePreference,
  resolveAppearance,
} from '../utils/appearancePreference';

describe('appearance preference utilities', () => {
  const mockStorage = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: jest.fn((k: string) => store[k] ?? null),
      setItem: jest.fn((k: string, v: string) => {
        store[k] = v;
      }),
      clear: () => {
        store = {};
      },
    };
  })();

  beforeEach(() => {
    (globalThis as any).localStorage = mockStorage;
    mockStorage.clear();
    jest.clearAllMocks();
  });

  it('validates appearance preference values', () => {
    expect(isAppearancePreference('auto')).toBe(true);
    expect(isAppearancePreference('light')).toBe(true);
    expect(isAppearancePreference('dark')).toBe(true);
    expect(isAppearancePreference('blue')).toBe(false);
  });

  it('stores and loads appearance preference from local storage', () => {
    persistAppearancePreference('dark');
    expect(loadStoredAppearancePreference('auto')).toBe('dark');
  });

  it('resolves auto appearance against system scheme', () => {
    expect(resolveAppearance('auto', 'dark')).toBe('dark');
    expect(resolveAppearance('auto', 'light')).toBe('light');
    expect(resolveAppearance('auto', null)).toBe('light');
    expect(resolveAppearance('dark', 'light')).toBe('dark');
  });
});
