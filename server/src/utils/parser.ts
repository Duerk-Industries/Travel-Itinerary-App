import { Docling } from 'docling-sdk';
import OpenAI from 'openai';
import { readFileSync } from 'node:fs';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import pLimit from 'p-limit';
import { reserveApiUsageOrThrow } from '../apis/usageLimiter';
import { estimateAiCostMicros, getApiBudgetWindowKey, recordApiCost, recordProviderRequestCost } from '../apis/providerBudgeting';

const LEGACY_DOCUMENT_PARSE_CALLER = 'LEGACY_DOCUMENT_PARSE';
const DOCUMENT_CONVERSION_CALLER = 'DOCUMENT_CONVERSION';

// Define the travel schema using Zod for type-safe extraction
const TravelSchema = z.object({
  hotels: z.array(z.object({
    name: z.string(),
    checkIn: z.string(),
    checkOut: z.string(),
    confirmationNumber: z.string()
  })),
  flights: z.array(z.object({
    airline: z.string(),
    flightNumber: z.string(),
    departureDate: z.string(),
    origin: z.string(),
    destination: z.string()
  })),
  tours: z.array(z.object({
    title: z.string(),
    date: z.string(),
    location: z.string()
  }))
});

// Define a type for the parsed travel data
export type TravelData = z.infer<typeof TravelSchema>;

// Rate limit to 2 concurrent requests to the OpenAI API
const limit = pLimit(2);

// Character limit for a single chunk.
// Assuming gpt-4o-mini's 128k context window and an average of 4 chars/token.
// We'll use a conservative 100k character limit to be safe.
const MARKDOWN_CHUNK_SIZE = 100000;

async function parseChunk(chunk: string, openai: OpenAI): Promise<TravelData | null> {
  try {
    await reserveApiUsageOrThrow({ provider: 'OPENAI', caller: LEGACY_DOCUMENT_PARSE_CALLER });
    const response = await openai.chat.completions.parse({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: 'You are a specialized travel data extractor. Extract travel details from the provided markdown document into a precise JSON format. If no travel data is present in the chunk, return empty arrays for hotels, flights, and tours.' 
        },
        { 
          role: 'user', 
          content: chunk 
        }
      ],
      response_format: zodResponseFormat(TravelSchema, 'travel_data'),
    });

    try {
      const amountMicros = estimateAiCostMicros({
        provider: 'OPENAI',
        model: 'gpt-4o-mini',
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
      });
      if ((amountMicros ?? 0) > 0) {
        await recordApiCost({
          provider: 'OPENAI',
          windowKey: getApiBudgetWindowKey(),
          amountMicros: amountMicros ?? 0,
        });
      }
    } catch (accountingError) {
      console.error('Failed to account for legacy OpenAI parsing:', accountingError);
    }

    return response.choices[0].message.parsed;
  } catch (error) {
    console.error("Failed to parse a chunk:", error);
    return null;
  }
}

export async function parseTravelDocument(filePath: string): Promise<TravelData | null> {
  // 1. Initialize Clients
  const docling = new Docling({ 
    api: { baseUrl: 'http://localhost:5001' } 
  });
  
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  try {
    // 2. Convert PDF or Image to Markdown
    const fileBuffer = readFileSync(filePath);
    await reserveApiUsageOrThrow({ provider: 'DOCLING', caller: DOCUMENT_CONVERSION_CALLER });
    await recordProviderRequestCost({ provider: 'DOCLING' });
    const conversion = await docling.convertFile({
      files: fileBuffer,
      filename: filePath.split('/').pop() || 'document.pdf',
      to_formats: ['md']
    });

    const markdownContent = conversion.document?.md_content || "";

    if (!markdownContent) {
      throw new Error("Failed to extract markdown from document.");
    }

    // 3. Split markdown into chunks
    const chunks: string[] = [];
    for (let i = 0; i < markdownContent.length; i += MARKDOWN_CHUNK_SIZE) {
      chunks.push(markdownContent.substring(i, i + MARKDOWN_CHUNK_SIZE));
    }

    // 4. Process chunks in parallel with rate limiting
    const parsingPromises = chunks.map(chunk => limit(() => parseChunk(chunk, openai)));
    const parsedChunks = await Promise.all(parsingPromises);

    // 5. Merge results
    const mergedResult: TravelData = {
      hotels: [],
      flights: [],
      tours: []
    };

    for (const parsed of parsedChunks) {
      if (parsed) {
        mergedResult.hotels.push(...parsed.hotels);
        mergedResult.flights.push(...parsed.flights);
        mergedResult.tours.push(...parsed.tours);
      }
    }

    return mergedResult;
  } catch (error) {
    console.error("Parsing failed:", error);
    return null;
  }
}
