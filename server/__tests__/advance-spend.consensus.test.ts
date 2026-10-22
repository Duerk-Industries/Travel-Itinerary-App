import { initDb, getApiCostCounter } from '../src/db';
import { extractCandidates } from '../src/ingestion/extraction';
import type { NormalizedDocument, ParsedItemCandidate, ExtractionResult } from '../src/ingestion/contracts';
const mockExtract = jest.fn();
jest.mock('../src/ingestion/extraction/llmExtractor', () => ({
  LlmExtractor: jest.fn().mockImplementation(() => ({extract:mockExtract})),
  quoteExtractionSpend: jest.fn(() => 60),
}));
jest.mock('../src/services/entitlementService', () => ({isFeatureEnabled:jest.fn(async (key:string) => key === 'ingestion_dual_llm_consensus')}));
jest.mock('../src/services/aiProviderConfigService', () => ({
  getActiveAiProvider:jest.fn(async () => ({provider:'openai',model:'gpt-4o-mini',source:'db',enabled:true})),
  getConfiguredProviderModels:jest.fn(() => ['gpt-4o-mini']),
}));
const original = process.env.NODE_ENV;
beforeAll(async () => { await initDb(); process.env.NODE_ENV='production'; });
afterAll(() => {process.env.NODE_ENV=original;});
it('reserves aggregate consensus spend before either model and falls back to individual review', async () => {
  const doc = {importJobId:'consensus-spend',userId:'11111111-1111-4111-8111-111111111111',sourceType:'MANUAL_UPLOAD',sourceId:'source',originalFilename:'booking.txt',mimeType:'text/plain',contentHash:'hash-spend',normalizedContentHash:'normalized-spend',normalizedText:'Travel confirmation',normalizedHtml:null,extractedTextSource:'plain',normalizationQuality:'STRUCTURAL_EXTRACT',rawSourceReference:'redacted',metadata:{},receivedAt:new Date().toISOString(),correlationId:'corr-spend'} as NormalizedDocument;
  const candidate = {itemType:'generic_note',sourceType:'MANUAL_UPLOAD',sourceDate:null,providerVendor:null,travelerNames:[],confirmationNumber:null,startDateTimeUtc:null,endDateTimeUtc:null,originalTimezone:null,timezoneStatus:'UNKNOWN',rawDatetimeString:null,timezoneDisplayHint:null,rawSourceReference:'redacted',confidenceScore:0.8,reviewStatus:'READY_FOR_REVIEW',deduplicationFingerprint:'fp',extractedFields:{summary:'Booking'},editedFields:null} as ParsedItemCandidate;
  const staticResult: ExtractionResult = {parsedItems:[candidate],usageMetrics:{tokensIn:0,tokensOut:0,provider:'static',modelName:null,estimatedCostUsd:0},metadata:{logicVersion:'test',extractedAt:new Date().toISOString(),strategyName:'Static'}};
  const result = await extractCandidates(doc,{logicVersion:'test',tokenBudgetUsd:0.0001,allowSmallLlm:true,allowLargeLlm:true,contentHash:doc.contentHash,userId:doc.userId,importJobId:doc.importJobId,correlationId:doc.correlationId},[{strategyName:'Static',minConfidenceToSkipNext:0.7,canHandle:()=>true,extract:async()=>staticResult}]);
  expect(mockExtract).not.toHaveBeenCalled();
  expect(result.metadata.strategyName).toBe('StaticParserBudgetReview');
  expect(result.parsedItems[0].extractedFields).toMatchObject({summary:'Booking',automaticAssignmentAllowed:false});
  expect(result.parsedItems[0].confidenceScore).toBeLessThan(0.7);
  expect(await getApiCostCounter('INGESTION_JOB_CONSENSUS_SPEND',new Date().toISOString().slice(0,7))).toBe(0);
});
