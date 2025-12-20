import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import fetch from 'node-fetch';

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

  const { country, days, budgetMin, budgetMax, traits } = req.body ?? {};
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
    `Traveler traits/preferences:`,
    traitLines,
    ``,
    `Rules:`,
    `- Return a short markdown-style itinerary with headings per day.`,
    `- Include 2-3 activities per day, tailored to budget and traits.`,
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
