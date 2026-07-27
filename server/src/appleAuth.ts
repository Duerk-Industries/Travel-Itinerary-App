import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import axios from 'axios';
import { getEnvValue } from './env';
import { logError } from './logger';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_TOKEN_ENDPOINT = 'https://appleid.apple.com/auth/token';
const APPLE_KEYS_ENDPOINT = 'https://appleid.apple.com/auth/keys';
// Apple caps client-secret JWTs at 6 months; stay comfortably under that.
const CLIENT_SECRET_TTL_SECONDS = 60 * 60 * 24 * 30 * 5;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

export interface AppleIdTokenClaims {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
  nonce?: string;
}

export const isAppleOAuthConfigured = (): boolean =>
  Boolean(
    getEnvValue('APPLE_CLIENT_ID') &&
      getEnvValue('APPLE_TEAM_ID') &&
      getEnvValue('APPLE_KEY_ID') &&
      getEnvValue('APPLE_PRIVATE_KEY') &&
      getEnvValue('APPLE_CALLBACK_URL')
  );

// server/.env stores the key as raw base64 DER (dotenv can't hold real
// newlines), so wrap it into PKCS8 PEM before handing it to jsonwebtoken.
const normalizeApplePrivateKey = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.includes('BEGIN PRIVATE KEY')) return trimmed.replace(/\\n/g, '\n');
  const body = trimmed.match(/.{1,64}/g)?.join('\n') ?? trimmed;
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
};

let cachedClientSecret: { token: string; expiresAt: number } | null = null;

const getAppleClientSecret = (): string => {
  const now = Math.floor(Date.now() / 1000);
  if (cachedClientSecret && cachedClientSecret.expiresAt - 60 > now) {
    return cachedClientSecret.token;
  }
  const teamId = getEnvValue('APPLE_TEAM_ID');
  const keyId = getEnvValue('APPLE_KEY_ID');
  const clientId = getEnvValue('APPLE_CLIENT_ID');
  const privateKeyRaw = getEnvValue('APPLE_PRIVATE_KEY');
  if (!teamId || !keyId || !clientId || !privateKeyRaw) {
    throw new Error('Apple OAuth is not configured');
  }
  const privateKey = normalizeApplePrivateKey(privateKeyRaw);
  const token = jwt.sign({}, privateKey, {
    algorithm: 'ES256',
    issuer: teamId,
    subject: clientId,
    audience: APPLE_ISSUER,
    keyid: keyId,
    expiresIn: CLIENT_SECRET_TTL_SECONDS,
  });
  cachedClientSecret = { token, expiresAt: now + CLIENT_SECRET_TTL_SECONDS };
  return token;
};

let cachedJwks: { keys: any[]; fetchedAt: number } | null = null;

const fetchApplePublicKey = async (kid: string): Promise<crypto.KeyObject> => {
  const now = Date.now();
  if (!cachedJwks || now - cachedJwks.fetchedAt > JWKS_CACHE_TTL_MS) {
    const { data } = await axios.get(APPLE_KEYS_ENDPOINT, { timeout: 10000 });
    cachedJwks = { keys: data.keys, fetchedAt: now };
  }
  let jwk = cachedJwks.keys.find((k: any) => k.kid === kid);
  if (!jwk) {
    // Apple rotates signing keys occasionally; refresh once before giving up.
    const { data } = await axios.get(APPLE_KEYS_ENDPOINT, { timeout: 10000 });
    cachedJwks = { keys: data.keys, fetchedAt: Date.now() };
    jwk = cachedJwks.keys.find((k: any) => k.kid === kid);
    if (!jwk) throw new Error(`No matching Apple JWKS key for kid=${kid}`);
  }
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
};

export const exchangeAppleAuthorizationCode = async (code: string): Promise<{ idToken: string }> => {
  const clientId = getEnvValue('APPLE_CLIENT_ID') || '';
  const clientSecret = getAppleClientSecret();
  const callbackUrl = getEnvValue('APPLE_CALLBACK_URL');
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
  });
  if (callbackUrl) params.set('redirect_uri', callbackUrl);

  try {
    const { data } = await axios.post(APPLE_TOKEN_ENDPOINT, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });
    if (!data.id_token) throw new Error('Apple token exchange did not return an id_token');
    return { idToken: data.id_token };
  } catch (err: any) {
    logError('[appleAuth] Token exchange failed', {
      message: err?.message,
      appleError: err?.response?.data,
    });
    throw err;
  }
};

export const verifyAppleIdToken = async (idToken: string, expectedNonce?: string): Promise<AppleIdTokenClaims> => {
  const clientId = getEnvValue('APPLE_CLIENT_ID');
  const decoded = jwt.decode(idToken, { complete: true }) as { header?: { kid?: string } } | null;
  const kid = decoded?.header?.kid;
  if (!kid) throw new Error('Apple id_token missing kid header');
  const publicKey = await fetchApplePublicKey(kid);
  const claims = jwt.verify(idToken, publicKey, {
    algorithms: ['RS256'],
    issuer: APPLE_ISSUER,
    audience: clientId,
  }) as AppleIdTokenClaims;
  if (!claims || !claims.sub || (expectedNonce && claims.nonce !== expectedNonce)) {
    throw new Error('Apple id_token nonce validation failed');
  }
  return claims;
};

export interface AppleAuthorizePayload {
  code: string;
  state?: string;
  /** JSON string of { name?: { firstName, lastName }, email }, sent by Apple on first authorization only. */
  user?: string;
}

export const parseAppleUserPayload = (
  raw: string | undefined
): { firstName?: string; lastName?: string } => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return {
      firstName: parsed?.name?.firstName,
      lastName: parsed?.name?.lastName,
    };
  } catch {
    return {};
  }
};
