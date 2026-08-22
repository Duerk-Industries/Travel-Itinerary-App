/**
 * Small, bundled, versioned corpus of feature-description snippets used to
 * ground the on-device guide assistant's answers in this app's *actual*
 * features -- see "Guide corpus" in
 * docs/implementation_plans/implementation-plan-ai-assistant.md.
 *
 * Deliberately not a vector DB / embeddings setup: a few dozen short docs
 * is small enough that keyword scoring is both sufficient and free of the
 * extra dependency weight. Keep entries short -- the model's context
 * window is 4096 tokens total (system prompt + retrieved entries +
 * conversation history + user message all share that budget).
 */

export type GuideCorpusEntry = {
  id: string;
  title: string;
  keywords: string[];
  content: string;
};

export const GUIDE_CORPUS: GuideCorpusEntry[] = [
  {
    id: 'trips',
    title: 'Creating and joining trips',
    keywords: ['trip', 'create trip', 'new trip', 'join trip', 'wizard', 'quick start', 'group', 'travelers'],
    content:
      'Start a new trip from the Home tab. Quick Start asks for just a name, destination, and dates; ' +
      '"Customize before creating" opens the full step-by-step wizard (dates, participants, itinerary, ' +
      'flights, lodging, activities, car rentals). Trips belong to a group -- invite fellow travelers by ' +
      'email during the wizard or later from the trip\'s Participants area.',
  },
  {
    id: 'transfers',
    title: 'Transfers tab (flights, trains, buses, ferries)',
    keywords: ['flight', 'flights', 'train', 'transfer', 'transfers', 'airport', 'departure', 'arrival', 'layover'],
    content:
      'The tab is called "Transfers" -- there is no separate "Flights" tab. It tracks flights, trains, ' +
      'buses, ferries, and private transfers all together. Each entry has a status (Needed, Proposed, ' +
      'Booked, Completed, or Cancelled). Add one manually, or paste a confirmation email/text and the ' +
      'flight parser will fill in the details for you.',
  },
  {
    id: 'lodging',
    title: 'Lodging and accommodations',
    keywords: ['lodging', 'hotel', 'hotels', 'stay', 'accommodation', 'check-in', 'check-out', 'airbnb'],
    content:
      'The Lodging tab tracks hotel and other stays: dates, cost per night, address, and who\'s paying. ' +
      'Tap a lodging row to see full details, edit it, or open its address in your preferred maps app.',
  },
  {
    id: 'activities',
    title: 'Activities and tours',
    keywords: ['activity', 'activities', 'tour', 'tours', 'sightseeing', 'things to do', 'event'],
    content:
      'The Activities tab tracks tours, sights, and events for each day of the trip -- start time, ' +
      'duration, location, and cost. Activities can be voted on and rated by everyone on the trip.',
  },
  {
    id: 'car-rentals',
    title: 'Car rentals',
    keywords: ['car rental', 'car rentals', 'rental car', 'pickup', 'dropoff'],
    content:
      'The Car Rentals tab tracks rental bookings: pickup/dropoff location and date, cost, and who\'s ' +
      'covering it in the shared expense split.',
  },
  {
    id: 'ai-itinerary',
    title: 'AI-generated itineraries',
    keywords: ['ai itinerary', 'generate itinerary', 'itinerary generation', 'plan my trip', 'day plan', 'day-by-day'],
    content:
      'When creating a trip, you can opt into an AI-generated day-by-day starter itinerary based on your ' +
      'destination, dates, and travel preferences -- it\'s generated in the background after you finish ' +
      'the wizard and appears on the Overview tab once ready. You can always build or edit an itinerary ' +
      'manually instead. This is a separate feature from this in-app assistant.',
  },
  {
    id: 'expenses',
    title: 'Expenses and cost splitting',
    keywords: ['expense', 'expenses', 'cost', 'costs', 'split', 'ledger', 'who owes', 'payment', 'receipt'],
    content:
      'Daily Expenses and the Ledger tab track shared costs and who owes whom, including receipts you ' +
      'can scan to auto-fill an expense. Every trip item (flights, lodging, activities, car rentals) can ' +
      'be marked as covered by specific travelers, and the ledger rolls that up into a settle-up summary.',
  },
  {
    id: 'overview',
    title: 'Overview and day view',
    keywords: ['overview', 'day view', 'today', 'schedule', 'itinerary status', 'needed', 'proposed', 'booked'],
    content:
      'The Overview tab shows the trip day by day, with each item\'s status (Needed -> Proposed -> Booked ' +
      '-> Completed, or Cancelled). Tap a day to see everything happening on it and edit items in place.',
  },
  {
    id: 'packing',
    title: 'Packing lists',
    keywords: ['packing', 'pack', 'packing list', 'suitcase', 'luggage'],
    content:
      'Packing Lists suggest items based on your trip\'s destination, dates, and activities, and track ' +
      'what you\'ve packed. Presets exist for common trip types (beach, hiking, business, etc.).',
  },
  {
    id: 'blog',
    title: 'Trip blog',
    keywords: ['blog', 'photos', 'photo album', 'memories', 'journal', 'share trip'],
    content:
      'The Trip Blog lets everyone on the trip post text and photos as a shared journal, private to the ' +
      'group by default. It can later be shared publicly with a link if you choose to.',
  },
  {
    id: 'account',
    title: 'Account, preferences, and traits',
    keywords: ['account', 'profile', 'preferences', 'traits', 'settings', 'home airport', 'currency', 'appearance', 'dark mode'],
    content:
      'The Account tab holds your profile (name, home address, preferred airport), appearance (light/dark), ' +
      'temperature units, and travel Traits -- preferences like pace or interests that personalize AI ' +
      'itinerary suggestions.',
  },
  {
    id: 'following',
    title: "Following other travelers' trips",
    keywords: ['follow', 'following', 'public trip', 'browse trips'],
    content:
      'You can follow other users\' public trips to browse their itineraries for inspiration. Following a ' +
      'trip is read-only -- you can\'t edit someone else\'s trip.',
  },
];

const normalize = (value: string): string => value.toLowerCase();

/**
 * Naive keyword-overlap scoring over a few dozen documents -- no vector DB
 * needed at this scale (see the corpus doc comment above). Returns entries
 * sorted by score, highest first; entries with zero keyword matches are
 * excluded rather than padded in, so a caller can tell "nothing relevant
 * found" apart from "found something, just not confident."
 */
export const retrieveRelevantGuideEntries = (
  query: string,
  limit = 3
): GuideCorpusEntry[] => {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery.trim()) return [];

  const scored = GUIDE_CORPUS.map((entry) => {
    let score = 0;
    for (const keyword of entry.keywords) {
      if (normalizedQuery.includes(normalize(keyword))) {
        // Multi-word keywords are a stronger, more specific signal than a
        // single common word matching incidentally.
        score += keyword.includes(' ') ? 2 : 1;
      }
    }
    return { entry, score };
  });

  return scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => entry);
};
