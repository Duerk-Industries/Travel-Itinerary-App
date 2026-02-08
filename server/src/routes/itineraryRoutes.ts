import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import axios from 'axios';
import { listTraitsForGroupTrip } from '../db';
import { logError } from '../logger';
import { getEnvValue } from '../env';
import { getGooglePlaceImage, getUnsplashImage } from '../image-service';

const PLACEHOLDER_IMAGE =
  'https://images.unsplash.com/photo-1502920917128-1aa500764b0e?auto=format&fit=crop&w=1200&q=80';

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

// Itineraries API: manage itineraries, details, and sharing helpers.
const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/images', async (req, res) => {
  const location = String(req.query.location || '').trim();
  if (!location) {
    res.status(400).json({ error: 'location is required' });
    return;
  }

  try {
    const placeId = req.query.placeId ? String(req.query.placeId).trim() : undefined;
    const url = placeId
      ? await getGooglePlaceImage(location, placeId)
      : await getUnsplashImage(location);
    res.json({ url, cached: true });
  } catch (err) {
    logError('[itinerary] image fetch error', err);
    res.json({ url: PLACEHOLDER_IMAGE, cached: false });
  }
});

router.post('/', async (req, res) => {
  const apiKey = getEnvValue('OPENAI_API_KEY');
  if (!apiKey) {
    res.status(500).json({ error: 'OpenAI API key not configured on server' });
    return;
  }
  if (/^sk-?x+/i.test(apiKey)) {
    res.status(500).json({ error: 'OpenAI API key appears to be a placeholder. Update OPENAI_API_KEY on the server.' });
    return;
  }

  const { country, locations, days, budgetMin, budgetMax, traits, departureAirport, tripId, tripStyle } = req.body ?? {};
  const userId = (req as any).user.userId as string;
  const selectedLocations = Array.isArray(locations)
    ? locations.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
  const destinationSummary = selectedLocations.length
    ? selectedLocations.join(', ')
    : String(country ?? '').trim();
  if (!destinationSummary) {
    res.status(400).json({ error: 'locations or country is required' });
    return;
  }
  const daysNum = Number(days);
  if (!Number.isFinite(daysNum) || daysNum <= 0) {
    res.status(400).json({ error: 'days must be a positive number' });
    return;
  }
  const min = Number(budgetMin);
  const max = Number(budgetMax);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) {
    res.status(400).json({ error: 'budget range is invalid' });
    return;
  }

  if (!tripId || typeof tripId !== 'string') {
    res.status(400).json({ error: 'tripId is required to tailor by group traits' });
    return;
  }

  const origin = departureAirport && String(departureAirport).trim();
  const styleLine = tripStyle && String(tripStyle).trim()
    ? `Traveler's requested vibe/style: ${String(tripStyle).trim()}`
    : '';

  let groupTraits: Array<{ userId: string; name: string; traits: string[] }> = [];
  try {
    groupTraits = await listTraitsForGroupTrip(userId, tripId);
  } catch (err: any) {
    const message = err?.message || '';
    if (/not authorized/i.test(message)) {
      res.status(403).json({
        error: 'Not authorized to generate an itinerary for this trip. Ensure you are signed in and belong to the trip group.',
        detail: message,
      });
      return;
    }
    if (/trip not found/i.test(message)) {
      res.status(404).json({
        error: 'Trip not found for itinerary generation. Select an active trip and try again.',
        detail: message,
      });
      return;
    }
    res.status(400).json({ error: message || 'Unable to fetch group traits' });
    return;
  }

  const traitLines =
    Array.isArray(traits) && traits.length
      ? traits
          .map(
            (t: any) =>
              `- ${String(t.name ?? '').trim()} (level ${Number(t.level) || 1})${
                t.notes ? ` — ${String(t.notes).trim()}` : ''
              }`
          )
          .join('\n')
      : 'None provided';

  const prompt = [
    `You are a concise travel planner. Create a day-by-day itinerary.`,
    `Primary destination context: ${destinationSummary}`,
    selectedLocations.length ? `Selected trip locations: ${selectedLocations.join(', ')}` : '',
    `Trip length: ${daysNum} day(s)`,
    `Budget range: $${min} - $${max}`,
    origin ? `Departure airport: ${origin}` : '',
    styleLine,
    `Traveler traits/preferences (requesting user):`,
    traitLines,
    `Group members and their traits (consider everyone when planning shared activities):`,
    groupTraits.length
      ? groupTraits
          .map((g) => `- ${g.name}: ${g.traits.length ? g.traits.join(', ') : 'No traits provided'}`)
          .join('\n')
      : '- No group traits available',
    ``,
    `Rules:`,
    `- Return a short markdown-style itinerary with headings per day.`,
    `- Optimize sequence/logistics across all selected locations when more than one is provided.`,
    `- Include 2-3 activities per day, tailored to budget and traits.`,
    `- EVERY activity line MUST include a cost with a leading $ (estimate if needed). Do not omit costs.`,
    `- If a departure airport is provided, estimate a reasonable round-trip flight cost from that airport to the destination, state it explicitly, and treat it as a budget line item (round trip).`,
    `- Show a quick budget summary noting flight cost and remaining on-the-ground budget for activities/food/lodging.`,
    `- Mention rough budget cues (e.g., "budget lunch", "free museum day").`,
    `- Keep total response under 250 words.`,
  ].join('\n');

  try {
    const aiRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You write concise, actionable travel itineraries.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const data = aiRes.data as ChatCompletionResponse;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      res.status(500).json({ error: 'No itinerary returned' });
      return;
    }

    res.json({ plan: content });
  } catch (err: any) {
    const detail = err.response?.data || err.message || String(err);
    logError(`[itinerary] OpenAI API error`, detail);
    res.status(500).json({ error: 'Failed to generate itinerary', detail });
  }
});

export default router;
