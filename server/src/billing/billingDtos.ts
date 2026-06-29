import { z } from 'zod';
import { SUPPORTED_PLAN_KEYS } from '../config/stripeBilling';
import type { BillingPlanKey, BillingSubscriptionStatus, TierKey } from '../types';

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------

export const createCheckoutSessionDto = z.object({
  planKey: z.enum(SUPPORTED_PLAN_KEYS as [BillingPlanKey, ...BillingPlanKey[]]),
  idempotencyKey: z.string().trim().min(1).max(128),
  clientPlatform: z.literal('web'),
});
export type CreateCheckoutSessionDto = z.infer<typeof createCheckoutSessionDto>;

export const createPortalSessionDto = z.object({}).strict();
export type CreatePortalSessionDto = z.infer<typeof createPortalSessionDto>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface CheckoutSessionResult {
  url: string;
}

export interface AlreadySubscribedResult {
  alreadySubscribed: true;
  message: string;
}

export type CreateCheckoutSessionResult = CheckoutSessionResult | AlreadySubscribedResult;

export interface PlanInfo {
  planKey: BillingPlanKey;
  amountCents: number;
  currency: string;
  interval: 'month' | 'year';
  trialDays: number;
}

export interface BillingStatusDto {
  effectiveTier: TierKey;
  isBillingManaged: boolean;
  plan: 'monthly' | 'annual' | null;
  subscriptionStatus: BillingSubscriptionStatus | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  trialEligible: boolean;
  trialEndingSoon: boolean;
  cancelAtPeriodEnd: boolean;
  inGracePeriod: boolean;
  accessRevoked: boolean;
  checkoutAvailable: boolean;
  portalAvailable: boolean;
}
