import { FlightParserStrategy } from './strategy';
import { GeminiFlightParser } from './gemini';
import { OpenAIFlightParser } from './openai';
import { getEnvValue } from '../../env';

export class FlightParserConfigurator {
  static getParser(): FlightParserStrategy {
    const provider = getEnvValue('LLM_PROVIDER', { defaultValue: 'gemini' })?.toLowerCase() || 'gemini';
    
    if (provider === 'openai') {
      return new OpenAIFlightParser();
    }
    
    // Default to Gemini
    return new GeminiFlightParser();
  }
}

export * from './strategy';
export * from './types';
