import { FlightParserStrategy } from './strategy';
import { GeminiFlightParser } from './gemini';
import { OpenAIFlightParser } from './openai';

export class FlightParserConfigurator {
  static getParser(): FlightParserStrategy {
    const provider = process.env.LLM_PROVIDER?.toLowerCase() || 'gemini';
    
    if (provider === 'openai') {
      return new OpenAIFlightParser();
    }
    
    // Default to Gemini
    return new GeminiFlightParser();
  }
}

export * from './strategy';
