export { tripNameToFileSlug } from '../src/utils/tripNameSlug';

export type WizardCliMustSeeAttraction = string | { name: string; destinationName?: string | null };

export type WizardCliPromptTraits = {
  tt?: Partial<{
    p: 'R' | 'B' | 'F'; // pace: Relaxed/Balanced/Fast
    c: 'B' | 'M' | 'L'; // comfort: Budget/Midrange/Luxury
    mob: 'L' | 'M' | 'H'; // mobility: Low/Medium/High
    car: 'P' | 'D' | 'R'; // car preference: PublicTransitOnly/DayTripsOnly/FullTripRental
    is: 'self_guided' | 'mixed' | 'guided'; // interaction style
    w: Partial<{
      outdoors: number;
      adventure: number;
      culture: number;
      food: number;
      nightlife: number;
      relax: number;
      photography: number;
      authentic_local: number;
      iconic_landmarks: number;
    }>; // interest weights, ints summing to ~100
  }>;
  ut?: Partial<{
    po: 'R' | 'B' | 'F'; // per-user pace override
    mob: 'L' | 'M' | 'H'; // per-user mobility override
    i: string[]; // per-user interest tags
    eb: boolean; // early bird
    no: boolean; // night owl
  }>;
};

export interface WizardCliInput {
  /** Used only for output file naming; NOT sent to AI generation. */
  tripName: string;

  /**
   * Optional. Without a userId, generation runs in the same anonymous/preview
   * mode the live app uses for logged-out users: the attraction catalog
   * shortlist and the per-attraction Wikipedia description enrichment are
   * both skipped entirely (see itineraryPromptPlanService.ts's `if (userId)`
   * gates), so every activity note comes back with no description. Set this
   * to any non-empty string (no real user record is required — duration
   * metadata is cached globally by destination+name, not per-user) to
   * exercise the real enrichment path and see actual attraction blurbs.
   */
  userId?: string;

  destinations: string[];
  mustSeeAttractions?: WizardCliMustSeeAttraction[];

  days: number;
  tripStartDate?: string | null; // ISO date, e.g. "2026-09-12"
  tripEndDate?: string | null;

  budgetMin: number;
  budgetMax: number;

  departureAirport?: string;
  tripStyle?: string;

  promptTraits?: WizardCliPromptTraits;
}

export const WIZARD_CLI_INPUT_EXAMPLE: WizardCliInput = {
  tripName: 'Boston and New York',
  destinations: ['Boston', 'New York City'],
  mustSeeAttractions: [
    'Freedom Trail',
    { name: 'Central Park', destinationName: 'New York City' },
    'American Museum of Natural History',
  ],
  days: 7,
  tripStartDate: '2026-09-12',
  tripEndDate: '2026-09-19',
  budgetMin: 1500,
  budgetMax: 4000,
  departureAirport: 'CLE',
  tripStyle: 'Culture and iconic landmarks, a couple of nice dinners',
  promptTraits: {
    tt: {
      p: 'B',
      c: 'M',
      mob: 'M',
      car: 'P',
      is: 'mixed',
      w: {
        outdoors: 10,
        adventure: 5,
        culture: 25,
        food: 15,
        nightlife: 10,
        relax: 10,
        photography: 15,
        authentic_local: 5,
        iconic_landmarks: 5,
      },
    },
    ut: { i: ['museums', 'walking tours'], eb: false, no: true },
  },
};
