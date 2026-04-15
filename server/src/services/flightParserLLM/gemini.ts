import { ParsedFlight } from '../../../../app/utils/parsers/transferParser';
import { FlightParserStrategy } from './strategy';
import { logError } from '../../logger';

export class GeminiFlightParser implements FlightParserStrategy {
  async parse(text: string): Promise<{ primary: Partial<ParsedFlight>; bulk: ParsedFlight[] }> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const prompt = `
Extract the flight itinerary from the following text and format it STRICTLY as a JSON object matching this TypeScript interface. Do NOT include any markdown formatting (like \`\`\`json). Just the raw JSON string.

export type ParsedFlight = {
  passengerName?: string;
  departureDate?: string; // YYYY-MM-DD
  departureLocation?: string; // City Name
  departureAirportCode?: string; // 3-letter IATA
  departureTime?: string; // HH:MM AM/PM
  arrivalLocation?: string; // City Name
  arrivalAirportCode?: string; // 3-letter IATA
  layoverLocation?: string;
  layoverLocationCode?: string;
  layoverDuration?: string; // e.g. "2h 30m"
  arrivalTime?: string; // HH:MM AM/PM
  cost?: string; // Numeric value only, e.g. "250.00"
  carrier?: string; // Airline name
  flightNumber?: string; // e.g. "AA123"
  bookingReference?: string; // Alphanumeric PNR
};

Return a JSON object with two top-level keys:
- "primary": A single ParsedFlight object containing the overall trip details.
- "bulk": An array of ParsedFlight objects. If there are multiple passengers or multiple segments, create a separate object for each passenger-segment combination. If it's just one passenger and one segment, "bulk" can be an empty array or have one item.

Text to parse:
"""
${text.substring(0, 10000)}
"""
`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      const contentText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      const cleanJsonStr = contentText.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleanJsonStr);

      return {
        primary: parsed.primary || {},
        bulk: Array.isArray(parsed.bulk) ? parsed.bulk : [],
      };
    } catch (err) {
      logError('[FlightParser] Gemini parsing failed', err);
      throw new Error('Failed to parse flight data using Gemini');
    }
  }
}
