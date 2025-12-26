import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import fetch from 'node-fetch';
import { listTraitsForGroupTrip } from '../db';

const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.post('/', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'OpenAI API key not configured on server' });
    return;
  }
  if (/^sk-?x+/i.test(apiKey)) {
    res.status(500).json({ error: 'OpenAI API key appears to be a placeholder. Update OPENAI_API_KEY on the server.' });
    return;
  }

  const { country, days, budgetMin, budgetMax, traits, departureAirport, tripId, tripStyle } = req.body ?? {};
  const userId = (req as any).user.userId as string;
  if (!country || !String(country).trim()) {
    res.status(400).json({ error: 'country is required' });
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
    res.status(400).json({ error: err?.message || 'Unable to fetch group traits' });
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
    `Destination country: ${String(country).trim()}`,
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
    `- Include 2-3 activities per day, tailored to budget and traits.`,
    `- EVERY activity line MUST include a cost with a leading $ (estimate if needed). Do not omit costs.`,
    `- If a departure airport is provided, estimate a reasonable round-trip flight cost from that airport to the destination, state it explicitly, and treat it as a budget line item (round trip).`,
    `- Show a quick budget summary noting flight cost and remaining on-the-ground budget for activities/food/lodging.`,
    `- Mention rough budget cues (e.g., "budget lunch", "free museum day").`,
    `- Keep total response under 250 words.`,
  ].join('\n');

  try {
    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You write concise, actionable travel itineraries.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    if (!aiRes.ok) {
      const text = await aiRes.text();
      console.error('[itinerary] OpenAI API error', aiRes.status, text);
      res.status(500).json({ error: 'Failed to generate itinerary', detail: text });
      return;
    }

    const data = await aiRes.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      res.status(500).json({ error: 'No itinerary returned' });
      return;
    }

    res.json({ plan: content });
  } catch (err) {
    console.error('[itinerary] Unexpected error', err);
    res.status(500).json({ error: 'Failed to generate itinerary', detail: (err as Error).message });
  }
});

export default router;
