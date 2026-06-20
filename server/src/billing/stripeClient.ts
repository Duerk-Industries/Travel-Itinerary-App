import Stripe from 'stripe';
import { STRIPE_API_VERSION, getStripeSecretKey, isStripeBillingEnabled } from '../config/stripeBilling';
import { logError } from '../logger';

// Lazy singleton — initialized on first call to getStripeClient().
let stripeInstance: Stripe | null = null;

// Test seam: inject a fake Stripe client in Jest without jest.mock('stripe').
// Call this in beforeEach / beforeAll in billing tests.
export const setStripeClientForTesting = (client: Stripe | null): void => {
  stripeInstance = client;
};

/**
 * Returns the shared Stripe client.
 * Throws if billing is disabled or the secret key is not configured.
 */
export const getStripeClient = (): Stripe => {
  if (stripeInstance) return stripeInstance;

  if (!isStripeBillingEnabled()) {
    throw new Error('[stripe] Stripe billing is disabled. Set STRIPE_BILLING_ENABLED=true to use billing features.');
  }

  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    throw new Error('[stripe] STRIPE_SECRET_KEY is not configured.');
  }

  stripeInstance = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    typescript: true,
  });

  return stripeInstance;
};

// ---------------------------------------------------------------------------
// Error normalization
// ---------------------------------------------------------------------------

export type StripeErrorKind =
  | 'card_error'
  | 'invalid_request'
  | 'authentication_error'
  | 'rate_limit'
  | 'api_error'
  | 'idempotency_error'
  | 'unknown';

export interface NormalizedStripeError {
  kind: StripeErrorKind;
  code: string | undefined;
  message: string;
  statusCode: number | undefined;
  declineCode: string | undefined;
}

/**
 * Converts a Stripe SDK error into a safe, loggable structure.
 * Never log the raw Stripe error object — it may contain request details.
 */
export const normalizeStripeError = (err: unknown): NormalizedStripeError => {
  if (err instanceof Stripe.errors.StripeError) {
    const kind: StripeErrorKind = (() => {
      switch (err.type) {
        case 'StripeCardError': return 'card_error';
        case 'StripeInvalidRequestError': return 'invalid_request';
        case 'StripeAuthenticationError': return 'authentication_error';
        case 'StripeRateLimitError': return 'rate_limit';
        case 'StripeAPIError': return 'api_error';
        case 'StripeIdempotencyError': return 'idempotency_error';
        default: return 'unknown';
      }
    })();
    return {
      kind,
      code: err.code,
      message: err.message,
      statusCode: err.statusCode,
      declineCode: (err as Stripe.errors.StripeCardError).decline_code ?? undefined,
    };
  }

  logError('[stripe] Non-Stripe error passed to normalizeStripeError', {
    name: (err as Error)?.name,
    message: (err as Error)?.message,
  });

  return {
    kind: 'unknown',
    code: undefined,
    message: (err as Error)?.message ?? 'Unknown error',
    statusCode: undefined,
    declineCode: undefined,
  };
};
