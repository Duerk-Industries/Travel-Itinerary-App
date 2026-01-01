import { Buffer } from 'buffer';

export const generateInviteGuid = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback GUID generator
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
};

export const generateShortInviteCode = (): string => {
  // 6-digit numeric code
  const num = Math.floor(100000 + Math.random() * 900000);
  return String(num);
};

export type InviteRecord = { tripId: string; tripName: string };

export class LocalInviteRegistry {
  private byTrip = new Map<string, string>();
  private byCode = new Map<string, InviteRecord>();

  create(tripId: string, tripName: string): string {
    const code = generateShortInviteCode();
    this.byTrip.set(tripId, code);
    this.byCode.set(code, { tripId, tripName });
    return code;
  }

  follow(code: string): InviteRecord | null {
    return this.byCode.get(code) ?? null;
  }
}

export type InvitePayload = { tripId: string; tripName: string; destination?: string };

// These helpers now return only the 6-digit code; payload must be stored alongside it.
export const encodeInviteCode = (_payload: InvitePayload): string => generateShortInviteCode();
export const decodeInviteCode = (_code: string): InvitePayload | null => null;
