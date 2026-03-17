import { INGESTION_FAILURE_MESSAGES } from '../config';
import type { UserVisibleFailureCode } from '../contracts';

export class IngestionError extends Error {
  public readonly code: UserVisibleFailureCode;
  public readonly httpStatus: number;
  public readonly retryAfterSeconds?: number;

  constructor(code: UserVisibleFailureCode, httpStatus = 400, retryAfterSeconds?: number, message?: string) {
    super(message ?? INGESTION_FAILURE_MESSAGES[code]);
    this.name = 'IngestionError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const getFailureMessage = (code: UserVisibleFailureCode): string => INGESTION_FAILURE_MESSAGES[code];
