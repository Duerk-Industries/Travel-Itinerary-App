/// <reference types="jest" />
/// <reference types="node" />
import { summarizeShadowParseCaptures } from '../src/ai/analytics/shadowParseSummary';
import type { CaptureBrowserItem } from '../src/ai/analytics/captureBrowser';

const makeRecord = (comparison: unknown): CaptureBrowserItem => ({
  captureId: `capture-${Math.random()}`,
  featureKey: 'shadow_parse',
  capturedAt: '2026-03-17T00:00:00.000Z',
  outcome: 'success',
  payloadSummary: { comparison },
});

describe('summarizeShadowParseCaptures', () => {
  it('returns an empty-but-valid summary when there are no records', () => {
    const summary = summarizeShadowParseCaptures([]);
    expect(summary).toEqual({
      sampleCount: 0,
      comparedSampleCount: 0,
      averageAgreementRate: null,
      byItemType: [],
      topMismatchedFields: [],
      source: 'local_capture_archive',
    });
  });

  it('averages agreement rate across records and ignores records with no comparison payload', () => {
    const records = [
      makeRecord({
        productionItemCount: 1,
        llmItemCount: 1,
        agreementRate: 1,
        itemComparisons: [{ itemType: 'flight', agreementRate: 1, fieldComparisons: [{ fieldName: 'departureAirportCode', status: 'same' }] }],
      }),
      makeRecord({
        productionItemCount: 1,
        llmItemCount: 1,
        agreementRate: 0.5,
        itemComparisons: [
          {
            itemType: 'flight',
            agreementRate: 0.5,
            fieldComparisons: [
              { fieldName: 'departureAirportCode', status: 'same' },
              { fieldName: 'arrivalAirportCode', status: 'both_different', productionValue: 'LAX', llmValue: 'SFO' },
            ],
          },
        ],
      }),
      makeRecord(null), // e.g. a skipped/errored shadow run with no comparison — should be excluded from the average
    ];

    const summary = summarizeShadowParseCaptures(records);
    expect(summary.sampleCount).toBe(3);
    expect(summary.comparedSampleCount).toBe(2);
    expect(summary.averageAgreementRate).toBeCloseTo(0.75, 5);
    expect(summary.byItemType).toEqual([{ itemType: 'flight', sampleCount: 2, averageAgreementRate: 0.75 }]);
    expect(summary.topMismatchedFields).toEqual([
      { itemType: 'flight', fieldName: 'arrivalAirportCode', mismatchCount: 1 },
    ]);
  });

  it('does not crash on production-redacted captures (itemComparisons with no fieldComparisons)', () => {
    // allowlistSerializer.ts strips fieldComparisons out of production-persisted
    // shadow_parse captures, keeping only itemType + agreementRate per item —
    // real captures on disk can legitimately look like this.
    const records = [
      makeRecord({
        productionItemCount: 1,
        llmItemCount: 1,
        agreementRate: 0.5,
        itemComparisons: [{ itemType: 'flight', agreementRate: 0.5 }],
      }),
    ];
    const summary = summarizeShadowParseCaptures(records);
    expect(summary.comparedSampleCount).toBe(1);
    expect(summary.averageAgreementRate).toBeCloseTo(0.5, 5);
    expect(summary.byItemType).toEqual([{ itemType: 'flight', sampleCount: 1, averageAgreementRate: 0.5 }]);
    expect(summary.topMismatchedFields).toEqual([]);
  });

  it('ranks mismatched fields by frequency, most-mismatched first', () => {
    const buildMismatch = (fieldName: string) => ({
      productionItemCount: 1,
      llmItemCount: 1,
      agreementRate: 0,
      itemComparisons: [
        {
          itemType: 'hotel',
          agreementRate: 0,
          fieldComparisons: [{ fieldName, status: 'production_only', productionValue: 'x' }],
        },
      ],
    });
    const records = [
      makeRecord(buildMismatch('checkInDate')),
      makeRecord(buildMismatch('checkInDate')),
      makeRecord(buildMismatch('address')),
    ];
    const summary = summarizeShadowParseCaptures(records);
    expect(summary.topMismatchedFields[0]).toEqual({ itemType: 'hotel', fieldName: 'checkInDate', mismatchCount: 2 });
    expect(summary.topMismatchedFields[1]).toEqual({ itemType: 'hotel', fieldName: 'address', mismatchCount: 1 });
  });
});
