import { buildFlightPayload, type Flight, type FlightEditDraft } from '../tabs/transfers';
import { buildLodgingPayload, type Lodging, type LodgingDraft } from '../tabs/lodging';
import { normalizeDateString } from './normalizeDateString';
import { LEGACY_ITINERARY_STATUS, normalizeItineraryStatus } from './itineraryStatus';

export type WizardGroupMember = {
  id: string;
  email?: string | null;
  guestName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  status?: string | null;
};

export type WizardSaveResult = {
  ok: boolean;
  failures: string[];
  fatal?: string;
};

const normalizeLookupKey = (value?: string | null): string => String(value ?? '').trim().toLowerCase();

const buildMemberLookups = (members: WizardGroupMember[]) => {
  const memberByEmail = new Map(
    members.map((m) => [normalizeLookupKey(m.email), m.id] as const).filter(([email]) => email)
  );
  const memberByGuest = new Map(
    members.map((m) => [normalizeLookupKey(m.guestName), m.id] as const).filter(([name]) => name)
  );
  return { memberByEmail, memberByGuest };
};

const resolveMemberId = (
  member: WizardGroupMember | undefined,
  memberByEmail: Map<string, string>,
  memberByGuest: Map<string, string>
): string | null => {
  if (!member) return null;
  const emailKey = normalizeLookupKey(member.email);
  if (emailKey) return memberByEmail.get(emailKey) ?? null;
  const guestKey = normalizeLookupKey(member.guestName);
  if (guestKey) return memberByGuest.get(guestKey) ?? null;
  return null;
};

export const saveWizardFlights = async (params: {
  backendUrl: string;
  headers: Record<string, string>;
  userToken: string | null;
  groupId: string;
  tripId: string;
  wizardFlights: Flight[];
  wizardGroupMembers: WizardGroupMember[];
}): Promise<WizardSaveResult> => {
  const { backendUrl, headers, userToken, groupId, tripId, wizardFlights, wizardGroupMembers } = params;
  if (!userToken || wizardFlights.length === 0) return { ok: true, failures: [] };

  try {
    const res = await fetch(`${backendUrl}/api/groups/${groupId}/members`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (!res.ok) {
      return { ok: false, failures: [], fatal: 'Trip created, but flights could not be saved.' };
    }
    const data = await res.json().catch(() => []);
    const members = (Array.isArray(data) ? data : []).map((m: any) => ({
      id: m.id,
      email: m.email ?? m.userEmail ?? undefined,
      guestName: m.guestName ?? m.guest_name ?? undefined,
      firstName: m.firstName ?? m.first_name ?? undefined,
      lastName: m.lastName ?? m.last_name ?? undefined,
      status: m.status ?? undefined,
    }));
    const activeMembers = members.filter((m) => m.status !== 'removed');
    const { memberByEmail, memberByGuest } = buildMemberLookups(members);
    const wizardMembersById = new Map(wizardGroupMembers.map((m) => [m.id, m] as const));
    const fallbackPassengerId = activeMembers[0]?.id ?? members[0]?.id ?? null;
    const fallbackPayerId = activeMembers[0]?.id ?? null;
    const failures: string[] = [];
    const todayIso = new Date().toISOString().slice(0, 10);

    for (const flight of wizardFlights) {
      const rawPassengerIds = Array.isArray(flight.passenger_ids) ? flight.passenger_ids : [];
      const resolvedPassengerIds: string[] = [];
      for (const id of rawPassengerIds) {
        const resolvedId = resolveMemberId(wizardMembersById.get(String(id)), memberByEmail, memberByGuest);
        if (resolvedId) resolvedPassengerIds.push(resolvedId);
      }

      const passengerIds = resolvedPassengerIds.length ? resolvedPassengerIds : fallbackPassengerId ? [fallbackPassengerId] : [];
      if (!passengerIds.length) {
        failures.push('Missing passengers for a flight.');
        continue;
      }

      const rawPaidBy = Array.isArray((flight as any).paidBy)
        ? (flight as any).paidBy
        : Array.isArray((flight as any).paid_by)
          ? (flight as any).paid_by
          : [];
      const resolvedPaidBy: string[] = [];
      for (const id of rawPaidBy) {
        const member = wizardMembersById.get(String(id));
        const emailKey = normalizeLookupKey(member?.email);
        if (!emailKey) continue;
        const resolvedId = memberByEmail.get(emailKey);
        if (resolvedId) resolvedPaidBy.push(resolvedId);
      }
      const paidBy = resolvedPaidBy.length ? resolvedPaidBy : fallbackPayerId ? [fallbackPayerId] : [];

      const draft: FlightEditDraft = {
        status: normalizeItineraryStatus((flight as any).status, LEGACY_ITINERARY_STATUS),
        passengerName: flight.passenger_name || 'Traveler',
        passengerIds,
        departureDate: normalizeDateString(flight.departure_date || '') || todayIso,
        arrivalDate:
          normalizeDateString((flight as any).arrival_date || '') ||
          normalizeDateString(flight.departure_date || '') ||
          todayIso,
        departureLocation: flight.departure_location ?? '',
        departureAirportCode: flight.departure_airport_code ?? '',
        departureTime: flight.departure_time || '00:00',
        arrivalLocation: flight.arrival_location ?? '',
        arrivalAirportCode: flight.arrival_airport_code ?? '',
        layoverLocation: flight.layover_location ?? '',
        layoverLocationCode: flight.layover_location_code ?? '',
        layoverDuration: flight.layover_duration ?? '',
        arrivalTime: flight.arrival_time || '00:00',
        cost: String(flight.cost ?? 0),
        carrier: flight.carrier || 'UNKNOWN',
        flightNumber: flight.flight_number || 'UNKNOWN',
        bookingReference: flight.booking_reference || 'UNKNOWN',
        paidBy,
      };
      const payload = buildFlightPayload(draft, tripId, fallbackPayerId ?? undefined);
      const saveRes = await fetch(`${backendUrl}/api/flights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      });
      if (!saveRes.ok) {
        const errData = await saveRes.json().catch(() => ({}));
        failures.push(errData.error || 'Failed to save flight');
      }
    }

    return { ok: failures.length === 0, failures };
  } catch {
    return { ok: false, failures: [], fatal: 'Trip created, but flights could not be saved.' };
  }
};

export const saveWizardLodgings = async (params: {
  backendUrl: string;
  headers: Record<string, string>;
  userToken: string | null;
  groupId: string;
  tripId: string;
  wizardLodgings: Lodging[];
  wizardGroupMembers: WizardGroupMember[];
}): Promise<WizardSaveResult> => {
  const { backendUrl, headers, userToken, groupId, tripId, wizardLodgings, wizardGroupMembers } = params;
  if (!userToken || wizardLodgings.length === 0) return { ok: true, failures: [] };

  try {
    const res = await fetch(`${backendUrl}/api/groups/${groupId}/members`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (!res.ok) {
      return { ok: false, failures: [], fatal: 'Trip created, but lodging could not be saved.' };
    }
    const data = await res.json().catch(() => []);
    const members = (Array.isArray(data) ? data : []).map((m: any) => ({
      id: m.id,
      email: m.email ?? m.userEmail ?? undefined,
      guestName: m.guestName ?? m.guest_name ?? undefined,
      firstName: m.firstName ?? m.first_name ?? undefined,
      lastName: m.lastName ?? m.last_name ?? undefined,
      status: m.status ?? undefined,
    }));
    const activeMembers = members.filter((m) => m.status !== 'removed');
    const { memberByEmail, memberByGuest } = buildMemberLookups(members);
    const wizardMembersById = new Map(wizardGroupMembers.map((m) => [m.id, m] as const));
    const fallbackPayerId = activeMembers[0]?.id ?? members[0]?.id ?? null;
    const failures: string[] = [];

    for (const lodging of wizardLodgings) {
      const rawPaidBy = Array.isArray((lodging as any).paidBy) ? (lodging as any).paidBy : [];
      const rawTravelerIds = Array.isArray((lodging as any).travelerIds)
        ? (lodging as any).travelerIds
        : rawPaidBy;
      const resolvedPaidBy: string[] = [];
      for (const id of rawPaidBy) {
        const resolvedId = resolveMemberId(wizardMembersById.get(String(id)), memberByEmail, memberByGuest);
        if (resolvedId) resolvedPaidBy.push(resolvedId);
      }
      const resolvedTravelerIds: string[] = [];
      for (const id of rawTravelerIds) {
        const resolvedId = resolveMemberId(wizardMembersById.get(String(id)), memberByEmail, memberByGuest);
        if (resolvedId) resolvedTravelerIds.push(resolvedId);
      }
      const paidBy = resolvedPaidBy.length ? resolvedPaidBy : fallbackPayerId ? [fallbackPayerId] : [];
      const travelerIds = resolvedTravelerIds.length ? resolvedTravelerIds : activeMembers.map((m) => m.id);

      const draft: LodgingDraft = {
        status: normalizeItineraryStatus((lodging as any).status, LEGACY_ITINERARY_STATUS),
        name: lodging.name,
        checkInDate: normalizeDateString(lodging.checkInDate),
        checkOutDate: normalizeDateString(lodging.checkOutDate),
        rooms: lodging.rooms || '1',
        refundBy: lodging.refundBy ? normalizeDateString(lodging.refundBy) : '',
        totalCost: lodging.totalCost || '',
        costPerNight: lodging.costPerNight || '',
        address: lodging.address || '',
        paidBy,
        travelerIds,
      };
      const { payload, error } = buildLodgingPayload(draft, tripId, fallbackPayerId ?? undefined);
      if (error || !payload) {
        failures.push(error || 'Failed to save lodging');
        continue;
      }
      payload.paidBy = paidBy;
      payload.travelerIds = travelerIds;
      const saveRes = await fetch(`${backendUrl}/api/lodgings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      });
      if (!saveRes.ok) {
        const errData = await saveRes.json().catch(() => ({}));
        failures.push(errData.error || 'Failed to save lodging');
      }
    }

    return { ok: failures.length === 0, failures };
  } catch {
    return { ok: false, failures: [], fatal: 'Trip created, but lodging could not be saved.' };
  }
};

