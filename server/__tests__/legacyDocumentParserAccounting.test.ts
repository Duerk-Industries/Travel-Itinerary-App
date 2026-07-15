/// <reference types="jest" />
/// <reference types="node" />

const mockConvertFile = jest.fn();
const mockParse = jest.fn();

jest.mock('../src/apis/usageLimiter', () => ({
  reserveApiUsageOrThrow: jest.fn(async () => undefined),
}));

jest.mock('../src/apis/providerBudgeting', () => ({
  recordProviderRequestCost: jest.fn(async () => undefined),
  estimateAiCostMicros: jest.fn(() => 9_000),
  getApiBudgetWindowKey: jest.fn(() => '2026-07'),
  recordApiCost: jest.fn(async () => 9_000),
}));

jest.mock('docling-sdk', () => ({
  Docling: jest.fn(() => ({ convertFile: mockConvertFile })),
}));

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn(() => ({ chat: { completions: { parse: mockParse } } })),
}));

describe('legacy document parser accounting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConvertFile.mockResolvedValue({ document: { md_content: 'travel markdown' } });
    mockParse.mockResolvedValue({
      choices: [{ message: { parsed: { hotels: [], flights: [], tours: [] } } }],
      usage: { prompt_tokens: 30, completion_tokens: 10 },
    });
  });

  it('limits and accounts for Docling conversion and legacy OpenAI parsing', async () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const os = require('node:os') as typeof import('node:os');
    const path = require('node:path') as typeof import('node:path');
    const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-parser-')), 'travel.pdf');
    fs.writeFileSync(filePath, 'pdf bytes');

    const { parseTravelDocument } = require('../src/utils/parser') as typeof import('../src/utils/parser');
    const { reserveApiUsageOrThrow } = require('../src/apis/usageLimiter') as typeof import('../src/apis/usageLimiter');
    const { recordProviderRequestCost, recordApiCost } = require('../src/apis/providerBudgeting') as typeof import('../src/apis/providerBudgeting');

    await expect(parseTravelDocument(filePath)).resolves.toEqual({ hotels: [], flights: [], tours: [] });

    expect(reserveApiUsageOrThrow).toHaveBeenCalledWith({ provider: 'DOCLING', caller: 'DOCUMENT_CONVERSION' });
    expect(reserveApiUsageOrThrow).toHaveBeenCalledWith({ provider: 'OPENAI', caller: 'LEGACY_DOCUMENT_PARSE' });
    expect(recordProviderRequestCost).toHaveBeenCalledWith({ provider: 'DOCLING' });
    expect(recordApiCost).toHaveBeenCalledWith({ provider: 'OPENAI', windowKey: '2026-07', amountMicros: 9_000 });
  });
});
