/// <reference types="jest" />
/// <reference types="node" />

import { buildRawStageCapture } from '../../src/services/itineraryPromptPlanService';

describe('itinerary raw prompt/response capture gating', () => {
  const originalFlag = process.env.ENABLE_RAW_AI_CAPTURE;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.ENABLE_RAW_AI_CAPTURE;
    else process.env.ENABLE_RAW_AI_CAPTURE = originalFlag;
  });

  it('omits raw text when ENABLE_RAW_AI_CAPTURE is unset', () => {
    delete process.env.ENABLE_RAW_AI_CAPTURE;
    expect(buildRawStageCapture('sys prompt', 'usr prompt', 'response body')).toEqual({});
  });

  it('omits raw text when ENABLE_RAW_AI_CAPTURE is explicitly falsy', () => {
    process.env.ENABLE_RAW_AI_CAPTURE = '0';
    expect(buildRawStageCapture('sys prompt', 'usr prompt', 'response body')).toEqual({});
  });

  it('includes raw prompt/response text when ENABLE_RAW_AI_CAPTURE is enabled', () => {
    process.env.ENABLE_RAW_AI_CAPTURE = '1';
    expect(buildRawStageCapture('sys prompt', 'usr prompt', 'response body')).toEqual({
      systemPrompt: 'sys prompt',
      userPrompt: 'usr prompt',
      responseText: 'response body',
    });
  });

  it('normalizes a missing response to an empty string when enabled', () => {
    process.env.ENABLE_RAW_AI_CAPTURE = '1';
    expect(buildRawStageCapture('sys', 'usr', null)).toEqual({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      responseText: '',
    });
  });
});
