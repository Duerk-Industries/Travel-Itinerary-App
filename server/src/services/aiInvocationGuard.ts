import { reserveApiUsageOrThrow } from '../apis/usageLimiter';
import type { UserRole } from '../types';
import {
  failGenerationUsage,
  finalizeGenerationUsage,
  reserveGenerationUsage,
} from './entitlementService';
import type { AiCallContext } from '../ai/types/aiChat';

export type AiGenerationUsageContext = {
  tripId: string;
  windowKey: string;
  idempotencyKey: string;
  role: UserRole;
};

export type AiCallContextWithUsage = AiCallContext & {
  generationUsage?: AiGenerationUsageContext;
};

export type AiCallAuthorization = {
  generationReservation?: Awaited<ReturnType<typeof reserveGenerationUsage>>;
  providerReserved: boolean;
};

export const getProviderLimitKey = (provider: string): string =>
  provider
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const getTierReservationPromise = async (
  ctx: AiCallContextWithUsage
): Promise<Awaited<ReturnType<typeof reserveGenerationUsage>> | undefined> => {
  if (!ctx.generationUsage) return undefined;
  return reserveGenerationUsage({
    userId: ctx.userId,
    tripId: ctx.generationUsage.tripId,
    role: ctx.generationUsage.role,
    windowKey: ctx.generationUsage.windowKey,
    idempotencyKey: ctx.generationUsage.idempotencyKey,
  });
};

export const authorizeAiCall = async (ctx: AiCallContextWithUsage): Promise<AiCallAuthorization> => {
  const tierReservationPromise = getTierReservationPromise(ctx);
  const providerReservationPromise = tierReservationPromise.then(async () => {
    await reserveApiUsageOrThrow({
      provider: getProviderLimitKey(ctx.provider),
      caller: ctx.callerId,
    });
    return true;
  });

  const [tierResult, providerResult] = await Promise.allSettled([
    tierReservationPromise,
    providerReservationPromise,
  ]);

  const generationReservation = tierResult.status === 'fulfilled' ? tierResult.value : undefined;

  if (providerResult.status === 'rejected') {
    if (generationReservation?.status === 'reserved' && ctx.generationUsage) {
      await failGenerationUsage(ctx.generationUsage.idempotencyKey, providerResult.reason?.message ?? String(providerResult.reason));
    }
    throw providerResult.reason;
  }

  if (tierResult.status === 'rejected') {
    throw tierResult.reason;
  }

  return {
    generationReservation,
    providerReserved: providerResult.value,
  };
};

export const finalizeAiCallAuthorization = async (
  ctx: AiCallContextWithUsage,
  authorization: AiCallAuthorization,
  responseBody: Record<string, unknown>
): Promise<void> => {
  if (authorization.generationReservation?.status !== 'reserved' || !ctx.generationUsage) return;
  await finalizeGenerationUsage({
    userId: ctx.userId,
    windowKey: ctx.generationUsage.windowKey,
    idempotencyKey: ctx.generationUsage.idempotencyKey,
    responseBody,
  });
};

export const failAiCallAuthorization = async (
  ctx: AiCallContextWithUsage,
  authorization: AiCallAuthorization | undefined,
  err: unknown
): Promise<void> => {
  if (authorization?.generationReservation?.status !== 'reserved' || !ctx.generationUsage) return;
  const message = err instanceof Error ? err.message : String(err);
  await failGenerationUsage(ctx.generationUsage.idempotencyKey, message);
};
