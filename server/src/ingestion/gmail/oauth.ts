import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getEnvValue } from '../../env';

type GmailOAuthStatePayload = {
  userId: string;
  redirectUri?: string;
  nonce: string;
  purpose: 'ingestion_gmail';
};

const secret = getEnvValue('AUTH_SECRET', { defaultValue: 'development-secret' })!;
const GMAIL_OAUTH_STATE_ISSUER = 'travel-itinerary-app-gmail';
const GMAIL_OAUTH_STATE_TTL = '10m';

export const createGmailOAuthState = (payload: { userId: string; redirectUri?: string }): string => {
  const state: GmailOAuthStatePayload = {
    userId: payload.userId,
    redirectUri: payload.redirectUri,
    nonce: crypto.randomUUID(),
    purpose: 'ingestion_gmail',
  };
  return jwt.sign(state, secret, { expiresIn: GMAIL_OAUTH_STATE_TTL, issuer: GMAIL_OAUTH_STATE_ISSUER });
};

export const decodeGmailOAuthState = (state: string): GmailOAuthStatePayload | null => {
  try {
    return jwt.verify(state, secret, { issuer: GMAIL_OAUTH_STATE_ISSUER }) as GmailOAuthStatePayload;
  } catch {
    return null;
  }
};
