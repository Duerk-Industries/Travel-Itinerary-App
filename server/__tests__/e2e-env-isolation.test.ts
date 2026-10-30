import dotenv from 'dotenv';
import { loadEnv } from '../src/env_loader';

it('does not load local credentials or service URLs in E2E mode', () => {
  const previous = process.env.E2E_MODE;
  const config = jest.spyOn(dotenv, 'config');
  try {
    process.env.E2E_MODE = '1';
    expect(loadEnv()).toBe('process.env/e2e');
    expect(loadEnv({ serverOnly: true })).toBe('process.env/e2e');
    expect(config).not.toHaveBeenCalled();
  } finally {
    if (previous === undefined) delete process.env.E2E_MODE;
    else process.env.E2E_MODE = previous;
    config.mockRestore();
  }
});
