import { z } from 'zod';

export const InterestWeightsSchema = z.object({
  outdoors: z.number().int().min(1).max(10),
  adventure: z.number().int().min(1).max(10),
  culture: z.number().int().min(1).max(10),
  food: z.number().int().min(1).max(10),
  nightlife: z.number().int().min(1).max(10),
  relaxing: z.number().int().min(1).max(10),
  photography: z.number().int().min(1).max(10),
  authentic_local: z.number().int().min(1).max(10),
  iconic_landmarks: z.number().int().min(1).max(10),
});

export const ActivityBlockSchema = z.object({
  block_id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  location_id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  zone_id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  role: z.enum(['anchor', 'supporting', 'filler', 'meal', 'rest', 'contingency']),
  category: z.string(),
  title: z.string().min(1).max(300),
  name_local: z.string().nullable(),
  name_script: z.string().nullable(),
  copy: z.object({
    teaser: z.string(),
    body: z.string(),
    insider_tip: z.string(),
    etiquette: z.string().nullable(),
    priority_signal: z.enum(['dont_skip', 'most_visitors_miss', 'optional']),
  }),
  timing: z.object({
    optimal_arrival: z.string().nullable(),
    hard_deadline: z.string().nullable(),
    time_box: z.string().nullable(),
    after_dark_value: z.boolean(),
  }),
  cost_band: z.object({
    currency: z.string(),
    low: z.number(),
    high: z.number(),
    note: z.string().nullable(),
  }),
  duration_minutes: z.object({
    typical: z.number().int().min(1),
    min: z.number().int().min(1),
    max: z.number().int().min(1),
  }),
  energy_cost: z.number().int().min(1).max(5),
  interest_weights: InterestWeightsSchema,
  source: z.enum(['curated', 'partner', 'llm_draft']),
  last_verified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export const BindingPlanSchema = z.object({
  days: z.array(z.object({
    day: z.number().int().min(1),
    template: z.string(),
    bindings: z.record(z.string().nullable()),
    zone_focus: z.string(),
    reason_codes: z.array(z.string()),
  })),
  contingency: z.record(z.object({
    if: z.string(),
    replace: z.string(),
    with: z.string(),
  })).optional(),
});

export type ActivityBlock = z.infer<typeof ActivityBlockSchema>;
export type BindingPlan = z.infer<typeof BindingPlanSchema>;
