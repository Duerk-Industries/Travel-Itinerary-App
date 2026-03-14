import { loadSession, saveSession, clearSession } from '../utils/session';

const createLocalStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
};

const localStorageMock = createLocalStorageMock();

beforeAll(() => {
  Object.defineProperty(global, 'window', {
    value: { localStorage: localStorageMock },
    configurable: true,
  });
});

describe('session persistence', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    localStorageMock.clear();
  });

  test('saveSession and loadSession round-trip stored data', () => {
    saveSession('token-1', 'Traveler', 'overview', 'traveler@example.com', 'trip-1', [], 'admin');
    const session = loadSession();
    expect(session).not.toBeNull();
    expect(session?.token).toBe('token-1');
    expect(session?.name).toBe('Traveler');
    expect(session?.email).toBe('traveler@example.com');
    expect(session?.page).toBe('overview');
    expect(session?.tripId).toBe('trip-1');
    expect(session?.role).toBe('admin');
  });

  test('clearSession removes the stored entry', () => {
    saveSession('token-2', 'Traveler', 'overview', 'traveler@example.com', 'trip-2');
    expect(loadSession()).not.toBeNull();
    clearSession();
    expect(loadSession()).toBeNull();
  });

  test('loadSession returns null when the entry has expired', () => {
    const nowSpy = jest.spyOn(Date, 'now');
    const twelveHoursMs = 12 * 60 * 60 * 1000;
    nowSpy.mockReturnValueOnce(0).mockReturnValue(twelveHoursMs + 1);
    saveSession('token-3', 'Traveler', 'overview', 'traveler@example.com', 'trip-3');
    expect(loadSession()).toBeNull();
  });
});
