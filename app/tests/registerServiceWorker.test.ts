/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import { registerOfflineShell, removeOfflineShell } from '../utils/registerServiceWorker';

const makeEnv = (over: { protocol?: string; hostname?: string; readyState?: string; nodeEnv?: string; disabled?: boolean } = {}) => {
  const listeners: Record<string, () => void> = {};
  const register = jest.fn(async () => ({}));
  const unregister = jest.fn(async () => true);
  const cacheNames = ['wb-shell-v1', 'wb-assets-v1', 'unrelated'];
  const deleted: string[] = [];
  const env = {
    nodeEnv: over.nodeEnv ?? 'production',
    disabled: over.disabled,
    win: {
      location: { protocol: over.protocol ?? 'https:', hostname: over.hostname ?? 'wander-bunnies.com' },
      document: { readyState: over.readyState ?? 'complete' },
      addEventListener: (name: string, fn: () => void) => { listeners[name] = fn; },
      caches: { keys: async () => cacheNames, delete: async (name: string) => { deleted.push(name); return true; } },
    },
    nav: { serviceWorker: { register, getRegistrations: async () => [{ unregister }] } },
  } as any;
  return { env, register, unregister, deleted, listeners };
};

describe('registerOfflineShell', () => {
  it('registers /sw.js at the site root in production over https', async () => {
    const { env, register } = makeEnv();
    expect(await registerOfflineShell(env)).toBe('registered');
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('waits for the page to finish loading so it never competes with the first render', async () => {
    const { env, register, listeners } = makeEnv({ readyState: 'loading' });
    const pending = registerOfflineShell(env);
    expect(register).not.toHaveBeenCalled();
    listeners.load!();
    expect(await pending).toBe('registered');
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('does nothing in development builds, on insecure origins, or in browsers without service workers', async () => {
    const dev = makeEnv({ nodeEnv: 'development' });
    expect(await registerOfflineShell(dev.env)).toBe('skipped-dev');
    expect(dev.register).not.toHaveBeenCalled();

    const insecure = makeEnv({ protocol: 'http:', hostname: 'example.com' });
    expect(await registerOfflineShell(insecure.env)).toBe('unsupported');

    const local = makeEnv({ protocol: 'http:', hostname: 'localhost' });
    expect(await registerOfflineShell(local.env)).toBe('registered');

    expect(await registerOfflineShell({ win: makeEnv().env.win, nav: {} })).toBe('unsupported');
  });

  it('reports failure instead of throwing when the browser refuses', async () => {
    const { env, register } = makeEnv();
    register.mockRejectedValueOnce(new Error('SecurityError'));
    expect(await registerOfflineShell(env)).toBe('failed');
  });

  it('rolls back: when disabled it unregisters the worker and deletes only its own caches', async () => {
    const { env, register, unregister, deleted } = makeEnv({ disabled: true });
    expect(await registerOfflineShell(env)).toBe('disabled');
    expect(register).not.toHaveBeenCalled();
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(deleted.sort()).toEqual(['wb-assets-v1', 'wb-shell-v1']);
  });
});

describe('removeOfflineShell', () => {
  it('never throws, even if cleanup is refused', async () => {
    const { env } = makeEnv();
    env.nav.serviceWorker.getRegistrations = async () => { throw new Error('blocked'); };
    await expect(removeOfflineShell(env)).resolves.toBeUndefined();
  });
});
