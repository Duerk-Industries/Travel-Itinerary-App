/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearSession,
  clearSessionAsync,
  loadLastActiveTripId,
  loadLastActiveTripIdAsync,
  loadSession,
  loadSessionAsync,
  saveSession,
  saveSessionAsync,
} from '../utils/session';

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

  test('last active trip remains available after logout for the same email', () => {
    saveSession('token-2', 'Traveler', 'overview', 'traveler@example.com', 'trip-2');
    clearSession();
    expect(loadSession()).toBeNull();
    expect(loadLastActiveTripId('traveler@example.com')).toBe('trip-2');
  });

  test('loadSession returns null when the entry has expired', () => {
    const nowSpy = jest.spyOn(Date, 'now');
    const twelveHoursMs = 12 * 60 * 60 * 1000;
    nowSpy.mockReturnValueOnce(0).mockReturnValue(twelveHoursMs + 1);
    saveSession('token-3', 'Traveler', 'overview', 'traveler@example.com', 'trip-3');
    expect(loadSession()).toBeNull();
  });

  describe('native AsyncStorage persistence', () => {
    let originalWindow: unknown;

    beforeEach(async () => {
      originalWindow = (global as any).window;
      Object.defineProperty(global, 'window', {
        value: undefined,
        configurable: true,
      });
      await AsyncStorage.clear();
    });

    afterEach(async () => {
      await AsyncStorage.clear();
      Object.defineProperty(global, 'window', {
        value: originalWindow,
        configurable: true,
      });
    });

    test('saveSessionAsync and loadSessionAsync round-trip data without localStorage', async () => {
      await saveSessionAsync('native-token-1', 'Native Traveler', 'overview', 'native@example.com', 'native-trip-1', ['home'], 'user');

      const session = await loadSessionAsync();

      expect(session).toEqual({
        token: 'native-token-1',
        name: 'Native Traveler',
        email: 'native@example.com',
        role: 'user',
        page: 'overview',
        pageHistory: ['home'],
        tripId: 'native-trip-1',
      });
      expect(await loadLastActiveTripIdAsync('native@example.com')).toBe('native-trip-1');
    });

    test('clearSessionAsync removes the native session but keeps last active trip', async () => {
      await saveSessionAsync('native-token-2', 'Native Traveler', 'overview', 'native@example.com', 'native-trip-2');

      await clearSessionAsync();

      expect(await loadSessionAsync()).toBeNull();
      expect(await loadLastActiveTripIdAsync('native@example.com')).toBe('native-trip-2');
    });

    test('loadSessionAsync removes expired native sessions', async () => {
      const nowSpy = jest.spyOn(Date, 'now');
      const twelveHoursMs = 12 * 60 * 60 * 1000;
      nowSpy.mockReturnValueOnce(0).mockReturnValue(twelveHoursMs + 1);
      await saveSessionAsync('native-token-3', 'Native Traveler', 'overview', 'native@example.com', 'native-trip-3');

      expect(await loadSessionAsync()).toBeNull();
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('stp.session');
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('stp.session.token');
    });
  });
});
