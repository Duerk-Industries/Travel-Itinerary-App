import type { Response } from 'express';
import { z, type ZodTypeAny } from 'zod';

/**
 * Thrown when an incoming request body does not match its DTO schema. The
 * `details` array carries the per-field issues so handlers can surface a
 * machine-readable error response instead of an opaque 400.
 */
export class DtoValidationError extends Error {
  readonly details: Array<{ path: string; message: string }>;

  constructor(message: string, details: Array<{ path: string; message: string }>) {
    super(message);
    this.name = 'DtoValidationError';
    this.details = details;
  }
}

const formatIssues = (error: z.ZodError): Array<{ path: string; message: string }> =>
  error.issues.map((issue) => ({
    path: issue.path.length === 0 ? '(root)' : issue.path.join('.'),
    message: issue.message,
  }));

/**
 * Validate `value` against `schema` and return the parsed result. On failure
 * throws a `DtoValidationError` so the calling route can render a consistent
 * 400 response shape.
 */
export const parseDto = <T extends ZodTypeAny>(schema: T, value: unknown): z.infer<T> => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new DtoValidationError('Request validation failed', formatIssues(result.error));
  }
  return result.data;
};

/**
 * Express helper: validate `req.body` against `schema`, or write a 400 JSON
 * error to `res` and return `null`. Designed so route handlers stay flat:
 *
 *   const dto = readDto(BulkDeleteDto, req.body, res);
 *   if (!dto) return;
 */
export const readDto = <T extends ZodTypeAny>(
  schema: T,
  value: unknown,
  res: Response
): z.infer<T> | null => {
  try {
    return parseDto(schema, value);
  } catch (error) {
    if (error instanceof DtoValidationError) {
      res.status(400).json({ error: error.message, details: error.details });
      return null;
    }
    throw error;
  }
};
