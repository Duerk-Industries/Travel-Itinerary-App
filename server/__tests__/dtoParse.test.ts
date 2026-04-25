import { z } from 'zod';
import { DtoValidationError, parseDto, readDto } from '../src/utils/dtoParse';

describe('parseDto', () => {
  const schema = z.object({
    name: z.string().min(1, 'name required'),
    count: z.number().int().nonnegative(),
  });

  it('returns the parsed value for a valid payload', () => {
    expect(parseDto(schema, { name: 'x', count: 3 })).toEqual({ name: 'x', count: 3 });
  });

  it('throws DtoValidationError with per-field details for invalid payloads', () => {
    let thrown: unknown;
    try {
      parseDto(schema, { name: '', count: -1 });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DtoValidationError);
    const err = thrown as DtoValidationError;
    expect(err.details.map((d) => d.path)).toEqual(expect.arrayContaining(['name', 'count']));
  });

  it('reports the root path for type errors at the top level', () => {
    let thrown: unknown;
    try {
      parseDto(schema, 'not-an-object');
    } catch (err) {
      thrown = err;
    }
    const err = thrown as DtoValidationError;
    expect(err.details[0].path).toBe('(root)');
  });
});

describe('readDto', () => {
  const schema = z.object({ tripId: z.string().min(1) });

  const buildRes = () => {
    const calls: { status?: number; body?: unknown } = {};
    const res = {
      status(code: number) {
        calls.status = code;
        return this;
      },
      json(body: unknown) {
        calls.body = body;
        return this;
      },
    } as any;
    return { res, calls };
  };

  it('returns the parsed dto on success and does not write to the response', () => {
    const { res, calls } = buildRes();
    const dto = readDto(schema, { tripId: 'abc' }, res);
    expect(dto).toEqual({ tripId: 'abc' });
    expect(calls.status).toBeUndefined();
    expect(calls.body).toBeUndefined();
  });

  it('writes a 400 with structured details on failure and returns null', () => {
    const { res, calls } = buildRes();
    const dto = readDto(schema, { tripId: '' }, res);
    expect(dto).toBeNull();
    expect(calls.status).toBe(400);
    expect((calls.body as any).error).toBe('Request validation failed');
    expect(Array.isArray((calls.body as any).details)).toBe(true);
    expect((calls.body as any).details[0].path).toBe('tripId');
  });
});
