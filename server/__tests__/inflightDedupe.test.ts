import {
  clearDefaultInflightDedupe,
  createInflightDedupe,
  dedupeInFlight,
} from '../src/utils/inflightDedupe';

describe('dedupeInFlight', () => {
  afterEach(() => {
    clearDefaultInflightDedupe();
  });

  it('returns the same promise for concurrent calls with the same key', async () => {
    let resolver: ((value: string) => void) | null = null;
    const fn = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolver = resolve;
        })
    );

    const first = dedupeInFlight('shared-key', fn);
    const second = dedupeInFlight('shared-key', fn);

    expect(first).toBe(second);
    expect(fn).toHaveBeenCalledTimes(1);

    resolver?.('result');
    await expect(first).resolves.toBe('result');
    await expect(second).resolves.toBe('result');
  });

  it('does not share promises across different keys', async () => {
    const fn = jest
      .fn<Promise<string>, [string]>()
      .mockResolvedValueOnce('a')
      .mockResolvedValueOnce('b');

    const a = dedupeInFlight('key-a', () => fn('a'));
    const b = dedupeInFlight('key-b', () => fn('b'));

    expect(a).not.toBe(b);
    await expect(a).resolves.toBe('a');
    await expect(b).resolves.toBe('b');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clears the registered promise on success so subsequent calls re-run the function', async () => {
    const fn = jest
      .fn<Promise<number>, []>()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);

    await expect(dedupeInFlight('key', fn)).resolves.toBe(1);
    await expect(dedupeInFlight('key', fn)).resolves.toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clears the registered promise on rejection so retries can re-run the function', async () => {
    const error = new Error('boom');
    const fn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('recovered');

    await expect(dedupeInFlight('retry-key', fn)).rejects.toBe(error);
    await expect(dedupeInFlight('retry-key', fn)).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('scoped registries do not collide with the default registry', async () => {
    const scoped = createInflightDedupe();
    const scopedFn = jest.fn().mockResolvedValue('scoped');
    const defaultFn = jest.fn().mockResolvedValue('default');

    await Promise.all([
      scoped.dedupe('same-key', scopedFn),
      dedupeInFlight('same-key', defaultFn),
    ]);

    expect(scopedFn).toHaveBeenCalledTimes(1);
    expect(defaultFn).toHaveBeenCalledTimes(1);
  });
});
