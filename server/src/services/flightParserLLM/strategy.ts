import { ParsedFlight } from '../../../../app/utils/parsers/transferParser';

export interface FlightParserStrategy {
  parse(text: string): Promise<{ primary: Partial<ParsedFlight>; bulk: ParsedFlight[] }>;
}
