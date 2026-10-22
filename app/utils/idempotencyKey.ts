import { randomUUID } from 'expo-crypto';

/** Expo supplies a cryptographic UUID on native as well as browsers. */
export const createIdempotencyKey = (prefix: string): string => `${prefix}_${randomUUID()}`;
