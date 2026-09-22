import axios from 'axios';
import { getEnvValue } from '../env';
import { reserveApiUsageOrThrow } from './usageLimiter';
import { recordProviderRequestCost } from './providerBudgeting';
import { logError } from '../logger';

// Talks to Expo's push HTTP API directly (https://docs.expo.dev/push-notifications/sending-notifications/)
// rather than depending on `expo-server-sdk`: that package ships ESM-only (`"type": "module"`, no
// CJS build) while this server compiles to CommonJS (tsconfig.json's `module: "CommonJS"`) — even
// a dynamic `import()` gets downleveled back to `require()` under that target, which throws at
// runtime against a pure-ESM package. A plain REST call over axios (already used for every other
// provider in this file — see unsplashApi.ts) sidesteps the whole problem and needs no SDK.
//
// Mobile only — this app is Expo-managed, so Expo's push service fronts both APNs and FCM without
// needing separate provider credentials.

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const MAX_MESSAGES_PER_REQUEST = 100; // Expo's own documented cap per call.

export type ExpoPushMessage = {
  to: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
};

export type ExpoPushTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string } };

export type PushSendResult = {
  // Parallel to the input messages array — index i's ticket corresponds to input i, so callers can
  // map a ticket back to which device/token it was for.
  tickets: Array<ExpoPushTicket | null>;
};

// Matches Expo's own token shape (ExponentPushToken[...] / ExpoPushToken[...]) — the format every
// expo-notifications client actually produces. Anything else can't be a real Expo push token, so
// it's filtered out before ever reaching the API rather than burning a request on a guaranteed 400.
export const isValidExpoPushToken = (token: string): boolean => /^Expo(nent)?PushToken\[.+\]$/.test(token);

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

export const sendExpoPushNotifications = async (params: {
  caller: string;
  messages: ExpoPushMessage[];
}): Promise<PushSendResult> => {
  const { messages } = params;
  const validFlags = messages.map((m) => isValidExpoPushToken(m.to));
  const valid = messages.filter((_, i) => validFlags[i]);
  if (!valid.length) return { tickets: messages.map(() => null) };

  await reserveApiUsageOrThrow({ provider: 'EXPO_PUSH', caller: params.caller });
  await recordProviderRequestCost({ provider: 'EXPO_PUSH' });

  const accessToken = getEnvValue('EXPO_ACCESS_TOKEN');
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  // Optional — only needed for Expo's higher security-tier "enhanced" push flow.
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const tickets: ExpoPushTicket[] = [];
  for (const batch of chunk(valid, MAX_MESSAGES_PER_REQUEST)) {
    try {
      const response = await axios.post<{ data: ExpoPushTicket[] }>(EXPO_PUSH_ENDPOINT, batch, { headers, timeout: 10_000 });
      const batchTickets = response.data?.data ?? [];
      // Defensive: a malformed/short response shouldn't desync the index alignment below — pad
      // with error tickets rather than let a later ticket silently apply to the wrong device.
      for (let i = 0; i < batch.length; i += 1) {
        tickets.push(batchTickets[i] ?? { status: 'error', message: 'Expo returned no ticket for this message' });
      }
    } catch (err) {
      // One batch failing (network blip, Expo outage) shouldn't drop tickets for every other
      // batch that already succeeded — mark just this batch's messages as errored so the caller's
      // per-token bookkeeping (disabling dead tokens, incrementing failure_count) stays accurate.
      logError('[expo-push] batch send failed', err);
      batch.forEach(() => tickets.push({ status: 'error', message: String((err as any)?.message ?? 'SEND_FAILED') }));
    }
  }

  // Re-expand back to the original (unfiltered) message order/length so index-based mapping in
  // deliverPush (notificationOutboxWorker.ts) stays correct even though invalid tokens were
  // skipped before ever reaching Expo.
  let ticketIndex = 0;
  const alignedTickets = messages.map((_, i) => (validFlags[i] ? tickets[ticketIndex++] ?? null : null));
  return { tickets: alignedTickets };
};
