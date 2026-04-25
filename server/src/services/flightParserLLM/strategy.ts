import { ParsedFlight } from './types';

export interface FlightParserStrategy {
  parse(text: string): Promise<{ primary: Partial<ParsedFlight>; bulk: ParsedFlight[] }>;
}
