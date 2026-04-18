import type { Request } from 'express';
import { getEnvValue } from '../../env';
import { createGmailOAuthState, decodeGmailOAuthState } from '../gmail/oauth';
import type { ExtractionResult, IngestionPayload } from '../contracts';
import { classifyDocumentContent, isSupportedMimeType, normalizeMimeType } from '../shared/parserSelection';
import { IngestionError } from '../shared/userFailures';
import { buildWebhookPayload } from './index';

const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GOOGLE_AUTH_BASE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API_BASE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';

type GmailTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

type GmailMessageListResponse = {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

type GmailPayloadPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  body?: {
    size?: number;
    data?: string;
    attachmentId?: string;
  };
  parts?: GmailPayloadPart[];
  headers?: Array<{ name: string; value: string }>;
};

type GmailMessageResponse = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPayloadPart;
};

const decodeBase64Url = (value?: string | null): Buffer => {
  if (!value) return Buffer.alloc(0);
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
};

const parseJsonSafe = async <T>(response: Response): Promise<T> => {
  return (await response.json()) as T;
};

const getHeaderValue = (part: GmailPayloadPart | undefined, headerName: string): string | null => {
  if (!part?.headers?.length) return null;
  const match = part.headers.find((header) => String(header.name).toLowerCase() === headerName.toLowerCase());
  return match?.value ?? null;
};

const collectSupportedParts = (part: GmailPayloadPart | undefined): GmailPayloadPart[] => {
  if (!part) return [];
  const currentMimeType = String(part.mimeType ?? '').toLowerCase();
  const currentFilename = String(part.filename ?? '').trim();
  const normalizedMimeType = normalizeMimeType(currentMimeType, currentFilename);
  const currentSupported = (currentFilename || part.body?.data || part.body?.attachmentId) && isSupportedMimeType(normalizedMimeType);
  const nested = (part.parts ?? []).flatMap((child) => collectSupportedParts(child));
  return currentSupported ? [part, ...nested] : nested;
};

const fetchGoogle = async (url: string, init: RequestInit): Promise<Response> => {
  return fetch(url, init);
};

export const getGmailCallbackUrl = (req: Request): string => {
  return getEnvValue('GOOGLE_GMAIL_CALLBACK_URL', {
    defaultValue: `${req.protocol}://${req.get('host')}/api/ingestion/gmail/callback`,
  })!;
};

export const buildGmailConsentUrl = (params: { userId: string; redirectUri?: string; request: Request }): { authUrl: string; scope: string } => {
  const clientId = getEnvValue('GOOGLE_CLIENT_ID', { required: true })!;
  const callbackUrl = getGmailCallbackUrl(params.request);
  const state = createGmailOAuthState({ userId: params.userId, redirectUri: params.redirectUri });
  const url = new URL(GOOGLE_AUTH_BASE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GMAIL_READONLY_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return { authUrl: url.toString(), scope: GMAIL_READONLY_SCOPE };
};

export const parseGmailOAuthState = (state: string) => decodeGmailOAuthState(state);

export const exchangeGmailCodeForTokens = async (params: {
  code: string;
  request: Request;
}): Promise<{ accessToken: string; refreshToken?: string | null; tokenExpiry: string | null; scope: string[] }> => {
  const clientId = getEnvValue('GOOGLE_CLIENT_ID', { required: true })!;
  const clientSecret = getEnvValue('GOOGLE_CLIENT_SECRET', { required: true })!;
  const redirectUri = getGmailCallbackUrl(params.request);
  const body = new URLSearchParams({
    code: params.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const response = await fetchGoogle(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    throw new IngestionError('provider_auth_expired', 400, undefined, 'Unable to exchange Gmail authorization code.');
  }
  const tokenData = await parseJsonSafe<GmailTokenResponse>(response);
  if (!tokenData.access_token) {
    throw new IngestionError('provider_auth_expired', 400, undefined, 'Missing Gmail access token.');
  }
  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    tokenExpiry: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString() : null,
    scope: String(tokenData.scope ?? GMAIL_READONLY_SCOPE).split(/\s+/).filter(Boolean),
  };
};

export const refreshGmailAccessToken = async (params: {
  refreshToken: string;
}): Promise<{ accessToken: string; tokenExpiry: string | null; scope: string[] }> => {
  const clientId = getEnvValue('GOOGLE_CLIENT_ID', { required: true })!;
  const clientSecret = getEnvValue('GOOGLE_CLIENT_SECRET', { required: true })!;
  const body = new URLSearchParams({
    refresh_token: params.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });
  const response = await fetchGoogle(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    throw new IngestionError('provider_auth_expired', 400, undefined, 'Unable to refresh Gmail access token.');
  }
  const tokenData = await parseJsonSafe<GmailTokenResponse>(response);
  if (!tokenData.access_token) {
    throw new IngestionError('provider_auth_expired', 400, undefined, 'Missing refreshed Gmail access token.');
  }
  return {
    accessToken: tokenData.access_token,
    tokenExpiry: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString() : null,
    scope: String(tokenData.scope ?? GMAIL_READONLY_SCOPE).split(/\s+/).filter(Boolean),
  };
};

export const fetchGmailProfile = async (accessToken: string): Promise<{ emailAddress: string; messagesTotal?: number; threadsTotal?: number }> => {
  const response = await fetchGoogle(`${GMAIL_API_BASE_URL}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new IngestionError('provider_auth_expired', 400, undefined, 'Unable to read Gmail profile.');
  }
  return parseJsonSafe<{ emailAddress: string; messagesTotal?: number; threadsTotal?: number }>(response);
};

const gmailSearchQuery = (lookbackDays: number): string => {
  const afterDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const yyyy = afterDate.getUTCFullYear();
  const mm = String(afterDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(afterDate.getUTCDate()).padStart(2, '0');
  return `after:${yyyy}/${mm}/${dd} (flight OR hotel OR reservation OR itinerary OR booking OR boarding OR airline OR rail OR train OR ferry OR bus OR rental OR restaurant OR event OR ticket)`;
};

export const listCandidateGmailMessages = async (accessToken: string, lookbackDays: number): Promise<Array<{ id: string; threadId: string }>> => {
  const url = new URL(`${GMAIL_API_BASE_URL}/messages`);
  url.searchParams.set('labelIds', 'INBOX');
  url.searchParams.set('maxResults', '25');
  url.searchParams.set('q', gmailSearchQuery(lookbackDays));
  const response = await fetchGoogle(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new IngestionError('provider_auth_expired', 400, undefined, 'Unable to search Gmail messages.');
  }
  const data = await parseJsonSafe<GmailMessageListResponse>(response);
  return data.messages ?? [];
};

export const getGmailMessage = async (accessToken: string, messageId: string): Promise<GmailMessageResponse> => {
  const url = new URL(`${GMAIL_API_BASE_URL}/messages/${messageId}`);
  url.searchParams.set('format', 'full');
  const response = await fetchGoogle(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new IngestionError('provider_auth_expired', 400, undefined, 'Unable to read Gmail message.');
  }
  return parseJsonSafe<GmailMessageResponse>(response);
};

const fetchGmailAttachmentBytes = async (accessToken: string, messageId: string, attachmentId: string): Promise<Buffer> => {
  const response = await fetchGoogle(`${GMAIL_API_BASE_URL}/messages/${messageId}/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new IngestionError('parse_failed_try_again', 400, undefined, 'Unable to read Gmail attachment.');
  }
  const data = await parseJsonSafe<{ data?: string }>(response);
  return decodeBase64Url(data.data);
};

const getPartBytes = async (accessToken: string, messageId: string, part: GmailPayloadPart): Promise<Buffer> => {
  if (part.body?.data) return decodeBase64Url(part.body.data);
  if (part.body?.attachmentId) return fetchGmailAttachmentBytes(accessToken, messageId, part.body.attachmentId);
  return Buffer.alloc(0);
};

export const isLikelyTravelMessage = (message: GmailMessageResponse): boolean => {
  const subject = getHeaderValue(message.payload, 'Subject') ?? '';
  const from = getHeaderValue(message.payload, 'From') ?? '';
  const summaryText = `${subject}\n${from}\n${message.snippet ?? ''}`;
  return classifyDocumentContent(summaryText).likelyTravelRelated;
};

export const buildGmailDryRunEntries = async (accessToken: string, lookbackDays: number): Promise<Array<{ id: string; subject: string; receivedAt: string }>> => {
  const candidates = await listCandidateGmailMessages(accessToken, lookbackDays);
  const messages = await Promise.all(candidates.map((candidate) => getGmailMessage(accessToken, candidate.id)));
  return messages
    .filter((message) => isLikelyTravelMessage(message))
    .map((message) => ({
      id: message.id,
      subject: getHeaderValue(message.payload, 'Subject') ?? '(no subject)',
      receivedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : new Date().toISOString(),
    }));
};

export const buildGmailIngestionPayloads = async (params: {
  accessToken: string;
  userId: string;
  lookbackDays: number;
}): Promise<IngestionPayload[]> => {
  const candidates = await listCandidateGmailMessages(params.accessToken, params.lookbackDays);
  const payloads: IngestionPayload[] = [];
  for (const candidate of candidates) {
    const message = await getGmailMessage(params.accessToken, candidate.id);
    if (!isLikelyTravelMessage(message)) continue;

    const subject = getHeaderValue(message.payload, 'Subject') ?? '(no subject)';
    const from = getHeaderValue(message.payload, 'From') ?? '';
    const receivedAt = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : new Date().toISOString();
    const supportedParts = collectSupportedParts(message.payload);

    for (let index = 0; index < supportedParts.length; index += 1) {
      const part = supportedParts[index]!;
      const filename = String(part.filename || `${subject.replace(/[^a-z0-9]+/gi, '-').slice(0, 40) || 'gmail-message'}-${index}`);
      const mimeType = normalizeMimeType(String(part.mimeType ?? ''), filename);
      if (!isSupportedMimeType(mimeType)) continue;
      const bytes = await getPartBytes(params.accessToken, message.id, part);
      if (!bytes.length) continue;
      payloads.push(
        await buildWebhookPayload({
          sourceType: 'GMAIL_IMPORT',
          userId: params.userId,
          filename,
          mimeType,
          bytes,
          externalMessageId: `${message.id}::part:${index}`,
          metadata: {
            provider: 'gmail',
            sourceChannel: 'gmail_import',
            gmailMessageId: message.id,
            gmailThreadId: message.threadId,
            subject,
            from,
            receivedAt,
          },
          dryRun: false,
        })
      );
      payloads[payloads.length - 1]!.receivedAt = receivedAt;
    }
  }
  return payloads;
};

export const ensureFutureDatedExtraction = (todayIsoDate: string) => (result: ExtractionResult): ExtractionResult => {
  const parsedItems = result.parsedItems
    .filter((item) => {
      if (!item.startDateTimeUtc) return true;
      return item.startDateTimeUtc.slice(0, 10) >= todayIsoDate;
    })
    .map((item) =>
      item.startDateTimeUtc
        ? item
        : {
            ...item,
            reviewStatus: 'LOW_CONFIDENCE' as const,
            confidenceScore: Math.min(item.confidenceScore, 0.69),
          }
    );
  return {
    ...result,
    parsedItems,
  };
};

export const GMAIL_READONLY_SCOPE_URL = GMAIL_READONLY_SCOPE;
