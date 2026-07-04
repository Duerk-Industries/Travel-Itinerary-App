/// <reference types="jest" />
/// <reference types="node" />

import { serializeForProduction } from '../../src/ai/capture/allowlistSerializer';
import type { CaptureRecord } from '../../src/ai/types/captureRecord';

const serializedText = (value: unknown): string => JSON.stringify(value);

describe('allowlistSerializer', () => {
  const originalSalt = process.env.AI_HASH_SALT;

  beforeEach(() => {
    process.env.AI_HASH_SALT = 'test-salt';
  });

  afterEach(() => {
    if (originalSalt === undefined) delete process.env.AI_HASH_SALT;
    else process.env.AI_HASH_SALT = originalSalt;
  });

  it('excludes known PII fields from production capture output', () => {
    const record: CaptureRecord = {
      captureSchemaVersion: 1,
      captureId: 'capture-1',
      featureKey: 'parsing',
      capturedAt: '2026-07-04T12:00:00.000Z',
      correlationId: 'corr-1',
      requestId: 'req-1',
      jobId: 'job-1',
      userId: 'user-raw-id',
      provider: 'openai',
      model: 'gpt-4o-mini',
      callerId: 'INGESTION_LLM_EXTRACT',
      outcome: 'success',
      tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      payload: {
        sourceType: 'MANUAL_UPLOAD',
        originalFilename: 'passport-for-jane-doe.pdf',
        rawEmailBody: 'Jane Doe, jane@example.com, +1 212 555 0199',
        rawPrompt: 'Authorization: Bearer secret-token-value',
        authHeader: 'Bearer abcdefghijklmnopqrstuvwxyz',
        cookie: 'sessionid=secret-cookie',
        paymentToken: 'tok_123456789abcdef',
        passportNumber: 'Passport number A12345678',
        address: '123 Main St, Boston, MA',
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+1 212 555 0199',
        parsedItems: [
          {
            itemType: 'hotel',
            providerVendor: 'Hotel Jane',
            confirmationNumber: 'ABC123',
            confidenceScore: 0.9,
            reviewStatus: 'READY_FOR_REVIEW',
            extractedFields: {
              guestName: 'Jane Doe',
              email: 'jane@example.com',
              phone: '+1 212 555 0199',
              address: '123 Main St',
              passportNumber: 'A12345678',
              paymentToken: 'tok_123456789abcdef',
            },
          },
        ],
      },
    };

    const output = serializeForProduction(record);
    const text = serializedText(output);

    expect(output.userId).toBeUndefined();
    expect(output.anonymousUserId).toEqual(expect.any(String));
    expect(output.redactionApplied).toBe(false);
    expect(text).not.toContain('user-raw-id');
    expect(text).not.toContain('Jane Doe');
    expect(text).not.toContain('jane@example.com');
    expect(text).not.toContain('212 555');
    expect(text).not.toContain('123 Main');
    expect(text).not.toContain('A12345678');
    expect(text).not.toContain('tok_123456789abcdef');
    expect(text).not.toContain('secret-cookie');
    expect(text).not.toContain('Bearer');
    expect(text).not.toContain('passport-for-jane-doe.pdf');
    expect(output.payload).toEqual({
      sourceType: 'MANUAL_UPLOAD',
      parsedItems: [
        {
          itemType: 'hotel',
          confidenceScore: 0.9,
          reviewStatus: 'READY_FOR_REVIEW',
        },
      ],
    });
  });

  it('redacts allowed diagnostic free-text fragments', () => {
    const record: CaptureRecord = {
      captureSchemaVersion: 1,
      captureId: 'capture-2',
      featureKey: 'itinerary_generation',
      capturedAt: '2026-07-04T12:00:00.000Z',
      outcome: 'success',
      payload: {
        destinationCount: 1,
        stages: [
          {
            stage: 'p0',
            callerId: 'ITINERARY_PLAN_P0_NORM',
            startedAt: '2026-07-04T12:00:00.000Z',
            completedAt: '2026-07-04T12:00:01.000Z',
            latencyMs: 1000,
            outcome: 'failure',
            promptTokens: 1,
            completionTokens: 1,
            responseChars: 10,
            parseError: 'Failed for jane@example.com',
          },
        ],
      },
    };

    const output = serializeForProduction(record);

    expect(output.redactionApplied).toBe(true);
    expect(serializedText(output)).not.toContain('jane@example.com');
    expect(serializedText(output)).toContain('[REDACTED]');
  });
});
