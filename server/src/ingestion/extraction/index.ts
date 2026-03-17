import { INGESTION_CONFIDENCE_HIGH, INGESTION_CONFIDENCE_REVIEW_READY, INGESTION_JOB_TOKEN_BUDGET_USD, INGESTION_LOGIC_VERSION } from '../config';
import type { ExtractionConfig, ExtractionResult, NormalizedDocument, ParsedItemCandidate, ParsedItemType } from '../contracts';
import { buildParsedItemFingerprint } from '../shared/hashing';
import { getExtractionCacheEntry, recordParseAttempt, recordUsageMetering, saveExtractionCacheEntry } from '../shared/repository';

export interface ExtractionStrategy {
  canHandle(doc: NormalizedDocument): boolean;
  extract(doc: NormalizedDocument, config: ExtractionConfig): Promise<ExtractionResult>;
  readonly strategyName: string;
  readonly minConfidenceToSkipNext: number;
}

const extractDate = (text: string): string | null => {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return new Date(`${iso[1]}T12:00:00Z`).toISOString();
  const named = text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2}\b/i);
  if (!named) return null;
  const parsed = new Date(named[0]);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const extractConfirmation = (text: string): string | null => {
  const match = text.match(/\b(?:confirmation|booking|reservation|record locator|pnr)\s*(?:number|code|ref(?:erence)?)?[:#\s-]+([A-Z0-9]{5,10})\b/i);
  return match ? match[1].toUpperCase() : null;
};

const extractTravelerNames = (text: string): string[] => {
  const matches = Array.from(text.matchAll(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g)).map((match) => match[1].trim());
  return Array.from(new Set(matches)).slice(0, 6);
};

const createCandidate = (params: {
  itemType: ParsedItemType;
  doc: NormalizedDocument;
  providerVendor?: string | null;
  confirmationNumber?: string | null;
  extractedFields: Record<string, unknown>;
  confidenceScore: number;
}): ParsedItemCandidate => {
  const travelerNames = extractTravelerNames(params.doc.normalizedText);
  const startDateTimeUtc = extractDate(params.doc.normalizedText);
  const candidate: ParsedItemCandidate = {
    itemType: params.itemType,
    sourceType: params.doc.sourceType,
    sourceDate: params.doc.receivedAt,
    providerVendor: params.providerVendor ?? null,
    travelerNames,
    confirmationNumber: params.confirmationNumber ?? null,
    startDateTimeUtc,
    endDateTimeUtc: null,
    originalTimezone: null,
    timezoneDisplayHint: startDateTimeUtc ? 'item-local' : 'timezone unknown',
    rawSourceReference: params.doc.rawSourceReference,
    confidenceScore: params.confidenceScore,
    reviewStatus: params.confidenceScore >= INGESTION_CONFIDENCE_REVIEW_READY ? 'READY_FOR_REVIEW' : 'LOW_CONFIDENCE',
    deduplicationFingerprint: '',
    extractedFields: params.extractedFields,
    editedFields: null,
  };
  candidate.deduplicationFingerprint = buildParsedItemFingerprint(candidate);
  return candidate;
};

class RegexExtractor implements ExtractionStrategy {
  readonly strategyName = 'RegexExtractor';
  readonly minConfidenceToSkipNext = INGESTION_CONFIDENCE_HIGH;

  canHandle(doc: NormalizedDocument): boolean {
    return doc.normalizedText.trim().length > 0;
  }

  async extract(doc: NormalizedDocument, _config: ExtractionConfig): Promise<ExtractionResult> {
    const text = doc.normalizedText;
    const lower = text.toLowerCase();
    const items: ParsedItemCandidate[] = [];
    if (/\b(flight|airline|boarding pass|departure|arrival|pnr|record locator)\b/.test(lower)) {
      items.push(
        createCandidate({
          itemType: /\b(train|rail)\b/.test(lower) ? 'rail' : /\b(ferry|bus transfer|coach)\b/.test(lower) ? 'ferry_bus_transfer' : 'flight',
          doc,
          providerVendor: text.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)* (?:Airlines|Airways|Rail|Ferry|Bus))\b/)?.[1] ?? null,
          confirmationNumber: extractConfirmation(text),
          extractedFields: {
            providerVendor: text.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)* (?:Airlines|Airways|Rail|Ferry|Bus))\b/)?.[1] ?? null,
            departureLocation: text.match(/\bfrom\s+([A-Z][A-Za-z .'-]+)/i)?.[1] ?? null,
            arrivalLocation: text.match(/\bto\s+([A-Z][A-Za-z .'-]+)/i)?.[1] ?? null,
            flightNumber: text.match(/\b([A-Z]{2}\s?\d{2,4})\b/)?.[1]?.replace(/\s+/g, '') ?? null,
            startDateTimeUtc: extractDate(text),
          },
          confidenceScore: /\b(boarding pass|flight number|pnr|record locator)\b/.test(lower) ? 0.94 : 0.82,
        })
      );
    }
    if (/\b(hotel|lodging|check-in|check-out|stay)\b/.test(lower)) {
      items.push(
        createCandidate({
          itemType: 'hotel',
          doc,
          providerVendor: text.match(/\b([A-Z][A-Za-z0-9 '&.-]+(?:Hotel|Resort|Inn|Suites))\b/)?.[1] ?? null,
          confirmationNumber: extractConfirmation(text),
          extractedFields: {
            name: text.match(/\b([A-Z][A-Za-z0-9 '&.-]+(?:Hotel|Resort|Inn|Suites))\b/)?.[1] ?? 'Imported lodging',
            address: text.match(/\baddress[:\s]+(.+)/i)?.[1] ?? null,
            freeCancelBy: extractDate(text.match(/free\s+cancel[a-z ]+([A-Za-z]{3,9}\s+\d{1,2},?\s+20\d{2}|20\d{2}-\d{2}-\d{2})/i)?.[0] ?? ''),
            rooms: Number(text.match(/\b(\d+)\s+rooms?\b/i)?.[1] ?? '1'),
            totalCost: Number(text.match(/\$([0-9,.]+)/)?.[1]?.replace(/,/g, '') ?? '0'),
            startDateTimeUtc: extractDate(text),
          },
          confidenceScore: /\b(check-in|check-out|reservation)\b/.test(lower) ? 0.91 : 0.75,
        })
      );
    }
    if (/\b(car rental|pickup|dropoff|rental agreement)\b/.test(lower)) {
      items.push(
        createCandidate({
          itemType: 'car_rental',
          doc,
          providerVendor: text.match(/\b(Hertz|Avis|Enterprise|Budget|National|Alamo|Sixt)\b/i)?.[1] ?? null,
          confirmationNumber: extractConfirmation(text),
          extractedFields: {
            pickupLocation: text.match(/\bpickup[:\s]+([A-Z][A-Za-z .'-]+)/i)?.[1] ?? null,
            dropoffLocation: text.match(/\bdropoff[:\s]+([A-Z][A-Za-z .'-]+)/i)?.[1] ?? null,
            model: text.match(/\b(vehicle|car)\s*[:\-]\s*([A-Za-z0-9 -]+)/i)?.[2] ?? null,
            cost: Number(text.match(/\$([0-9,.]+)/)?.[1]?.replace(/,/g, '') ?? '0'),
            startDateTimeUtc: extractDate(text),
          },
          confidenceScore: 0.83,
        })
      );
    }
    if (/\b(restaurant reservation|restaurant|table for|event ticket|concert|tour|activity)\b/.test(lower)) {
      const itemType: ParsedItemType = /\brestaurant\b/.test(lower)
        ? 'restaurant_reservation'
        : /\b(event|concert|ticket)\b/.test(lower)
          ? 'event_ticket'
          : 'tour_activity';
      items.push(
        createCandidate({
          itemType,
          doc,
          providerVendor: text.match(/\bprovider[:\s]+([A-Z][A-Za-z .'-]+)/i)?.[1] ?? null,
          confirmationNumber: extractConfirmation(text),
          extractedFields: {
            name: text.match(/\b(?:event|tour|activity|restaurant)\s*[:\-]\s*([A-Z][A-Za-z0-9 '&.-]+)/i)?.[1] ?? 'Imported activity',
            location: text.match(/\blocation[:\s]+([A-Z][A-Za-z .'-]+)/i)?.[1] ?? null,
            duration: text.match(/\b(\d+\s*(?:hours?|hrs?|minutes?|mins?))\b/i)?.[1] ?? null,
            cost: Number(text.match(/\$([0-9,.]+)/)?.[1]?.replace(/,/g, '') ?? '0'),
            startDateTimeUtc: extractDate(text),
          },
          confidenceScore: 0.78,
        })
      );
    }
    if (!items.length) {
      items.push(
        createCandidate({
          itemType: 'generic_note',
          doc,
          providerVendor: null,
          confirmationNumber: extractConfirmation(text),
          extractedFields: {
            summary: text.slice(0, 500),
            notes: text.slice(0, 2000),
          },
          confidenceScore: extractDate(text) ? 0.72 : 0.48,
        })
      );
    }
    return {
      parsedItems: items,
      usageMetrics: {
        tokensIn: 0,
        tokensOut: 0,
        provider: 'regex',
        modelName: null,
        estimatedCostUsd: 0,
      },
      metadata: {
        logicVersion: INGESTION_LOGIC_VERSION,
        extractedAt: new Date().toISOString(),
        strategyName: this.strategyName,
      },
    };
  }
}

class NoopLlmExtractor implements ExtractionStrategy {
  constructor(
    readonly strategyName: string,
    readonly minConfidenceToSkipNext: number,
    private readonly canRun: (config: ExtractionConfig) => boolean
  ) {}

  canHandle(_doc: NormalizedDocument): boolean {
    return true;
  }

  async extract(doc: NormalizedDocument, config: ExtractionConfig): Promise<ExtractionResult> {
    if (!this.canRun(config)) {
      return {
        parsedItems: [],
        usageMetrics: {
          tokensIn: 0,
          tokensOut: 0,
          provider: this.strategyName,
          modelName: null,
          estimatedCostUsd: 0,
        },
        metadata: {
          logicVersion: config.logicVersion,
          extractedAt: new Date().toISOString(),
          strategyName: this.strategyName,
        },
      };
    }
    return {
      parsedItems: [
        createCandidate({
          itemType: 'generic_note',
          doc,
          extractedFields: {
            summary: doc.normalizedText.slice(0, 500),
          },
          confidenceScore: 0.55,
        }),
      ],
      usageMetrics: {
        tokensIn: 200,
        tokensOut: 100,
        provider: 'llm',
        modelName: this.strategyName,
        estimatedCostUsd: 0.01,
      },
      metadata: {
        logicVersion: config.logicVersion,
        extractedAt: new Date().toISOString(),
        strategyName: this.strategyName,
      },
    };
  }
}

const defaultStrategies = [
  new RegexExtractor(),
  new NoopLlmExtractor('SmallLLMExtractor', INGESTION_CONFIDENCE_REVIEW_READY, (config) => config.allowSmallLlm),
  new NoopLlmExtractor('LargeLLMExtractor', 1, (config) => config.allowLargeLlm),
];

export const extractCandidates = async (
  doc: NormalizedDocument,
  config: Omit<ExtractionConfig, 'logicVersion' | 'tokenBudgetUsd'> & Partial<Pick<ExtractionConfig, 'logicVersion' | 'tokenBudgetUsd'>>,
  strategies: ExtractionStrategy[] = defaultStrategies
): Promise<ExtractionResult> => {
  const extractionConfig: ExtractionConfig = {
    logicVersion: config.logicVersion ?? INGESTION_LOGIC_VERSION,
    tokenBudgetUsd: config.tokenBudgetUsd ?? INGESTION_JOB_TOKEN_BUDGET_USD,
    allowSmallLlm: config.allowSmallLlm,
    allowLargeLlm: config.allowLargeLlm,
    contentHash: config.contentHash,
    userId: config.userId,
    importJobId: config.importJobId,
    correlationId: config.correlationId,
  };

  const cached = await getExtractionCacheEntry(extractionConfig.userId, extractionConfig.contentHash, extractionConfig.logicVersion);
  if (cached) {
    return cached as unknown as ExtractionResult;
  }

  let bestResult: ExtractionResult | null = null;
  let attemptNumber = 0;
  let cumulativeCost = 0;

  for (const strategy of strategies) {
    if (!strategy.canHandle(doc)) continue;
    const startedAt = new Date().toISOString();
    attemptNumber += 1;
    const result = await strategy.extract(doc, extractionConfig);
    const completedAt = new Date().toISOString();
    cumulativeCost += result.usageMetrics.estimatedCostUsd;
    await recordParseAttempt({
      importJobId: extractionConfig.importJobId,
      stage: strategy.strategyName.includes('LLM') ? 'SMALL_LLM' : 'REGEX',
      extractorName: strategy.strategyName,
      logicVersion: extractionConfig.logicVersion,
      attemptNumber,
      startedAt,
      completedAt,
      outcome: result.parsedItems.length ? `${strategy.strategyName.toLowerCase()}_succeeded` : `${strategy.strategyName.toLowerCase()}_empty`,
      confidenceScore: Math.max(...result.parsedItems.map((item) => item.confidenceScore), 0),
      tokensIn: result.usageMetrics.tokensIn,
      tokensOut: result.usageMetrics.tokensOut,
      modelName: result.usageMetrics.modelName,
      errorCode: null,
    });
    await recordUsageMetering({
      userId: extractionConfig.userId,
      importJobId: extractionConfig.importJobId,
      sourceType: doc.sourceType,
      parserStage: strategy.strategyName,
      provider: result.usageMetrics.provider,
      modelName: result.usageMetrics.modelName,
      tokenCountIn: result.usageMetrics.tokensIn,
      tokenCountOut: result.usageMetrics.tokensOut,
      estimatedCostUsd: result.usageMetrics.estimatedCostUsd,
    });
    if (!bestResult || Math.max(...result.parsedItems.map((item) => item.confidenceScore), 0) > Math.max(...bestResult.parsedItems.map((item) => item.confidenceScore), 0)) {
      bestResult = result;
    }
    if (cumulativeCost > extractionConfig.tokenBudgetUsd) {
      throw new Error('Token budget exceeded for import job');
    }
    if (result.parsedItems.some((item) => item.confidenceScore >= strategy.minConfidenceToSkipNext)) {
      break;
    }
  }

  const finalResult =
    bestResult ??
    ({
      parsedItems: [],
      usageMetrics: { tokensIn: 0, tokensOut: 0, provider: 'none', modelName: null, estimatedCostUsd: 0 },
      metadata: {
        logicVersion: extractionConfig.logicVersion,
        extractedAt: new Date().toISOString(),
        strategyName: 'none',
      },
    } satisfies ExtractionResult);
  await saveExtractionCacheEntry(extractionConfig.userId, extractionConfig.contentHash, extractionConfig.logicVersion, finalResult as unknown as Record<string, unknown>);
  return finalResult;
};
