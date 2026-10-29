import { importItineraryDocumentIntoTrip, isDuplicateItineraryCandidate, __clearExtractionCache } from '../src/services/itineraryDocumentImportService';
import { isWanderBunniesPrint, parseWanderBunniesPrint } from '../src/services/wanderBunniesPrintParser';
import * as db from '../src/db';
import * as aiProviderConfigService from '../src/services/aiProviderConfigService';
import * as aiProviderRegistry from '../src/ai/registry/aiProviderRegistry';

jest.mock('../src/db');
jest.mock('../src/services/aiProviderConfigService');
jest.mock('../src/ai/registry/aiProviderRegistry');

const mockedDb = db as jest.Mocked<typeof db>;

test('preserves Needs Booking on printed hotels and activities', () => {
  const { candidates } = parseWanderBunniesPrint(PRINTED.replaceAll('StatusBooked', 'StatusNeeds Booking'));
  expect(candidates.find(candidate => candidate.type === 'hotel')?.status).toBe('Needs Booking');
  expect(candidates.find(candidate => candidate.name === 'Sagrada Familia')?.status).toBe('Needs Booking');
});

// Text as pdf-parse returns it for an itinerary printed by WanderBunnies: each label is glued to its
// value, headings are uppercase kinds, and a booking repeats on every day it appears.
const PRINTED = `

TRAVEL ITINERARY
Spring in Spain
Monday, March 2, 2026 - Friday, March 6, 2026 · Spain
TRIP LENGTH
5 days
TRAVELERS
Alex Rivera, Sam Rivera
CURRENCY
USD
DAY 1Monday, March 2, 2026
FLIGHTBOS → MAD
Departure20:00 · BOSArrival09:30 · MAD
TravelersAlex Rivera, Sam RiveraBooking referenceZX81QP
CostUSD 812.40
DAY 2Tuesday, March 3, 2026
FLIGHTBOS → MAD
Departure20:00 · BOSArrival09:30 · MAD
TravelersAlex Rivera, Sam RiveraBooking referenceZX81QP
CostUSD 812.40
TRAINMadrid Atocha → Barcelona Sants
Departure14:00 · Madrid AtochaArrival16:45 · Barcelona Sants
TravelersAlex Rivera, Sam RiveraLayoverZaragoza Delicias
Layover duration0h 10mCostUSD 61.00
ACCOMMODATIONHotel Gracia Norte
Check-inTuesday, March 3, 2026Check-outFriday, March 6, 2026
AddressCarrer d'Astúries 12, Barcelona, SpainRooms1
StatusBookedRefund byMonday, March 2, 2026
TotalUSD 540.00Per nightUSD 180.00
Coordinates41.40360, 2.17440Coordinate sourcemanual
ACTIVITYSagrada Familia
Time10:00LocationCarrer de Mallorca 401, Barcelona
Duration2h00StatusBookedCategorySights & LandmarksBooking referenceSF-2210
CostUSD 58.00Free cancellation byMonday, March 2, 2026
Coordinates41.40363, 2.17436Coordinate sourcecatalog
DAY 3Wednesday, March 4, 2026
ACCOMMODATIONHotel Gracia Norte
Check-inTuesday, March 3, 2026Check-outFriday, March 6, 2026
AddressCarrer d'Astúries 12, Barcelona, SpainRooms1
StatusBookedRefund byMonday, March 2, 2026
TotalUSD 540.00Per nightUSD 180.00
ACTIVITYMercat de la Boqueria
Time9:00LocationLa Rambla 91, Barcelona
Duration1h00StatusProposed
CostUSD 0.00
ACTIVITYMercat de la Boqueria
Time18:30LocationLa Rambla 91,
Barcelona
Duration0h45StatusProposed
CostUSD 0.00
ACTIVITYPark Güell
LocationCarrer d'Olot, Barcelona
Duration1h30StatusProposedCategoryOutdoor Activity
CostUSD 0.00
CAR RENTALHertz
VehicleFiat 500Pick upWednesday, March 4, 2026 · Barcelona Airport
Drop offThursday, March 5, 2026 · Barcelona Sants
ReferenceHZ-4471PrepaidNoCostUSD 95.00Bring the child seat.
PLACEBar del Pla
19:30
Cost: 40.00
CHECKLISTPacking
□ Passports
✓ Chargers
DAY 4Thursday, March 5, 2026
CAR RENTALHertz
VehicleFiat 500Pick upWednesday, March 4, 2026 · Barcelona Airport
Drop offThursday, March 5, 2026 · Barcelona Sants
ReferenceHZ-4471PrepaidNoCostUSD 95.00Bring the child seat.
CAR RENTALAvis
VehicleSeat IbizaPick upThursday, March 5, 2026 · Barcelona Sants
Drop offFriday, March 6, 2026 · Madrid Atocha
ReferenceAV-9PrepaidYesCostUSD 80.00Pick-up coordinates41.37900, 2.14000
Drop-off coordinates40.40650, -3.68950Coordinate sourcegeocoderNotesNo smoking.
10/21/2026, 2:00 PM
Spring in Spain
about:blank
3/9
ACCOMMODATIONHotel Gracia Norte
Check-inTuesday, March 3, 2026Check-outFriday, March 6, 2026
AddressCarrer d'Astúries 12, Barcelona, SpainRooms1
StatusBookedRefund byMonday, March 2, 2026
TotalUSD 540.00Per nightUSD 180.00
DAY 5Friday, March 6, 2026
FLIGHTMAD → BOS
Departure11:00 · MADArrival13:30 · BOS
TravelersAlex Rivera, Sam RiveraBooking referenceZX81QP
CostUSD 0.00
Trip notes
Keep booking references and timing details with you while traveling. Costs shown are the values currently saved in WanderBunnies.
Printed from WanderBunnies · 10/21/2026
`;

describe('WanderBunnies printout parser', () => {
  test('recognises its own printout and nothing else', () => {
    expect(isWanderBunniesPrint(PRINTED)).toBe(true);
    expect(isWanderBunniesPrint('Day 1 Arrive Paris\nDay 2 Louvre')).toBe(false);
  });

  test('recovers every transfer, merging a booking printed on its departure and arrival days', () => {
    const { candidates } = parseWanderBunniesPrint(PRINTED);
    const transfers = candidates.filter((c) => c.type === 'flight' || c.type === 'rail');
    expect(transfers.map((c) => c.name)).toEqual(['BOS → MAD', 'Madrid Atocha → Barcelona Sants', 'MAD → BOS']);
    expect(transfers[0]).toEqual(expect.objectContaining({
      departureDate: '2026-03-02', arrivalDate: '2026-03-03', departureTime: '20:00', arrivalTime: '09:30',
      confirmationNumber: 'ZX81QP', totalCost: 812.4, travelerNames: 'Alex Rivera, Sam Rivera',
    }));
    expect(transfers[1]).toEqual(expect.objectContaining({
      type: 'rail', layoverLocation: 'Zaragoza Delicias', layoverDuration: '0h 10m', totalCost: 61,
      flight: expect.objectContaining({ transferType: 'Public Transit' }),
    }));
  });

  test('keeps lodging fields once for a multi-night stay', () => {
    const hotels = parseWanderBunniesPrint(PRINTED).candidates.filter((c) => c.type === 'hotel');
    expect(hotels).toHaveLength(1);
    expect(hotels[0]).toEqual(expect.objectContaining({
      name: 'Hotel Gracia Norte', checkInDate: '2026-03-03', checkOutDate: '2026-03-06', rooms: 1, status: 'Booked',
      refundBy: '2026-03-02', totalCost: 540, costPerNight: 180, address: "Carrer d'Astúries 12, Barcelona, Spain",
    }));
  });

  test('recovers activities, including a repeat visit and one with no start time', () => {
    const activities = parseWanderBunniesPrint(PRINTED).candidates.filter((c) => c.type === 'tour_activity');
    expect(activities.map((c) => [c.name, c.activityDate, c.activityTime])).toEqual([
      ['Sagrada Familia', '2026-03-03', '10:00'],
      ['Mercat de la Boqueria', '2026-03-04', '9:00'],
      ['Mercat de la Boqueria', '2026-03-04', '18:30'],
      ['Park Güell', '2026-03-04', null],
    ]);
    expect(activities[0]).toEqual(expect.objectContaining({
      status: 'Booked', confirmationNumber: 'SF-2210', totalCost: 58, freeCancelBy: '2026-03-02', duration: '2h00',
    }));
    expect(activities[2].location).toBe('La Rambla 91, Barcelona');
  });

  test('recovers the activity category, and falls back for an older printout without one', () => {
    const activities = parseWanderBunniesPrint(PRINTED).candidates.filter((c) => c.type === 'tour_activity');
    expect(activities.map((c) => c.activity?.activityType)).toEqual(['Sights & Landmarks', null, null, 'Outdoor Activity']);
    const unknown = parseWanderBunniesPrint(PRINTED.replace('CategorySights & Landmarks', 'CategoryMade Up Type'));
    expect(unknown.candidates.find((c) => c.name === 'Sagrada Familia')?.activity?.activityType).toBeNull();
  });

  test('recovers coordinates with their source, only where the printout has them', () => {
    const { candidates } = parseWanderBunniesPrint(PRINTED);
    const sagrada = candidates.find((c) => c.name === 'Sagrada Familia')!;
    expect(sagrada).toEqual(expect.objectContaining({ lat: 41.40363, lng: 2.17436, coordinateSource: 'catalog' }));
    const hotel = candidates.find((c) => c.type === 'hotel')!;
    expect(hotel).toEqual(expect.objectContaining({ lat: 41.4036, lng: 2.1744, coordinateSource: 'manual' }));
    const avis = candidates.find((c) => c.providerVendor === 'Avis')!;
    expect(avis).toEqual(expect.objectContaining({
      lat: 41.379, lng: 2.14, dropoffLat: 40.4065, dropoffLng: -3.6895, coordinateSource: 'geocoder', notes: 'No smoking.', prepaid: 'Yes', totalCost: 80,
    }));
    expect(candidates.find((c) => c.name === 'Park Güell')).not.toHaveProperty('lat');
    expect(candidates.find((c) => c.providerVendor === 'Hertz')).not.toHaveProperty('lat');
  });

  test('rejects impossible coordinates and unknown sources', () => {
    const bad = PRINTED.replace('Coordinates41.40363, 2.17436Coordinate sourcecatalog', 'Coordinates95.0, 2.1Coordinate sourcecatalog')
      .replace('Coordinates41.40360, 2.17440Coordinate sourcemanual', 'Coordinates41.4036, 2.1744Coordinate sourcemadeup');
    const { candidates } = parseWanderBunniesPrint(bad);
    expect(candidates.find((c) => c.name === 'Sagrada Familia')).not.toHaveProperty('lat');
    expect(candidates.find((c) => c.type === 'hotel')).toEqual(expect.objectContaining({ coordinateSource: 'manual' }));
  });

  test('reads text where the extractor puts a space between each label and its value', () => {
    const spaced = [
      'TRAVEL ITINERARY', 'Spring in Spain', 'CURRENCY', 'EUR',
      'DAY 1 Monday, March 2, 2026',
      'FLIGHT BOS → MAD', 'Departure 20:00 · BOS Arrival 09:30 · MAD', 'Travelers Alex Rivera, Sam Rivera Booking reference ZX81QP', 'Cost EUR 812.40',
      'ACCOMMODATION Hotel Gracia Norte', 'Check-in Monday, March 2, 2026 Check-out Wednesday, March 4, 2026', 'Address Carrer 12, Barcelona Rooms 1',
      'Status Booked Refund by Sunday, March 1, 2026', 'Total EUR 360.00 Per night EUR 180.00', 'Coordinates 41.40360, 2.17440 Coordinate source catalog',
      'ACTIVITY Sagrada Familia', 'Time 10:00 Location Carrer de Mallorca 401', 'Duration 2h00 Status Booked Category Sights & Landmarks', 'Cost EUR 58.00',
      'Trip notes', 'Printed from WanderBunnies · 3/1/2026',
    ].join('\n');
    const { candidates, currency } = parseWanderBunniesPrint(spaced);
    expect(currency).toBe('EUR');
    expect(candidates.map((c) => c.type)).toEqual(['flight', 'hotel', 'tour_activity']);
    expect(candidates[0]).toEqual(expect.objectContaining({ name: 'BOS → MAD', departureTime: '20:00', arrivalTime: '09:30', confirmationNumber: 'ZX81QP', totalCost: 812.4 }));
    expect(candidates[1]).toEqual(expect.objectContaining({ name: 'Hotel Gracia Norte', checkInDate: '2026-03-02', totalCost: 360, lat: 41.4036, coordinateSource: 'catalog' }));
    expect(candidates[2]).toEqual(expect.objectContaining({ name: 'Sagrada Familia', activityTime: '10:00', status: 'Booked', activity: expect.objectContaining({ activityType: 'Sights & Landmarks' }) }));
  });

  test('reads the cover currency', () => {
    expect(parseWanderBunniesPrint(PRINTED).currency).toBe('USD');
    expect(parseWanderBunniesPrint(PRINTED.replace('CURRENCY\nUSD', 'CURRENCY\nEUR')).currency).toBe('EUR');
  });

  test('recovers a car rental with its note and ignores print headers and footers', () => {
    const rentals = parseWanderBunniesPrint(PRINTED).candidates.filter((c) => c.type === 'car_rental');
    expect(rentals).toHaveLength(2);
    expect(rentals[0]).toEqual(expect.objectContaining({
      providerVendor: 'Hertz', vehicleType: 'Fiat 500', pickupDate: '2026-03-04', pickupLocation: 'Barcelona Airport',
      dropoffDate: '2026-03-05', dropoffLocation: 'Barcelona Sants', confirmationNumber: 'HZ-4471', prepaid: 'No',
      totalCost: 95, notes: 'Bring the child seat.',
    }));
  });

  test('recovers day-plan places and checklists', () => {
    const { details } = parseWanderBunniesPrint(PRINTED);
    expect(details).toEqual([
      expect.objectContaining({ kind: 'place', title: 'Bar del Pla', time: '19:30', cost: 40, date: '2026-03-04', day: 3 }),
      expect.objectContaining({ kind: 'checklist', title: 'Packing', checklist: [{ label: 'Passports', checked: false }, { label: 'Chargers', checked: true }] }),
    ]);
  });
});

// A format-v2 printout: trip notes and guide before day 1, labelled status and dates on transfers, quoted
// multi-line notes, lodging features, checklist state, a place's address, and an UNSCHEDULED section.
const PRINTED_V2 = `
TRAVEL ITINERARY
Japan Spring
Monday, April 5, 2027 - Wednesday, April 7, 2027
TRIP LENGTH
3 days
CURRENCY
USD
TRIP NOTES
> Book the Shinkansen first.
>
> FLIGHT prices rise after Nov 1.
TRIP GUIDE
> Day one is a long travel day.
DAY 1Monday, April 5, 2027
FLIGHTBOS → NRT
Departure23:00 · BOSArrival06:00 · NRT
CostUSD 900.00StatusBookedDeparture dateMonday, April 5, 2027Arrival dateTuesday, April 6, 2027
DAY 2Tuesday, April 6, 2027
FLIGHTBOS → NRT
Departure23:00 · BOSArrival06:00 · NRT
CostUSD 900.00StatusBookedDeparture dateMonday, April 5, 2027Arrival dateTuesday, April 6, 2027
ACCOMMODATIONRyokan Yamashiro
Check-inTuesday, April 6, 2027Check-outWednesday, April 7, 2027
Address12 Gion, KyotoRooms1StatusProposed
FeaturesBreakfast, Dinner
Notes
> Ask for a private onsen.
>
> Second paragraph.
ACTIVITYFushimi Inari
Time15:00LocationFushimi, Kyoto
Duration2hStatusNeeds BookingCategoryHike
Booked onKlook
Notes
> Go early; closes at dusk.
NOTEBooking priorities
> 1. Shinkansen
> OTHER: ryokan fills early
CHECKLISTBefore dinner
☑ Reserve table
☐ Charge phone
PLACEBar del Pla
19:30
AddressCarrer 1, Barcelona
Coordinates41.40360, 2.17440Coordinate sourcemanual
UNSCHEDULED
ACTIVITYTea ceremony
LocationGion
DurationStatusProposed
Travel tips
Keep booking references and timing details with you while traveling.
Printed from WanderBunnies · 10/26/2026 · Format v2
`;

describe('WanderBunnies printout parser, format v2', () => {
  test('reads the version, the trip notes and the trip guide', () => {
    const parsed = parseWanderBunniesPrint(PRINTED_V2);
    expect(parsed.version).toBe(2);
    expect(parsed.tripNotes).toBe('Book the Shinkansen first.\n\nFLIGHT prices rise after Nov 1.');
    expect(parsed.tripGuide).toBe('Day one is a long travel day.');
    expect(parseWanderBunniesPrint(PRINTED).version).toBe(1);
    expect(parseWanderBunniesPrint(PRINTED).tripNotes).toBeNull();
  });

  test('uses the printed transfer dates and status instead of guessing from adjacency', () => {
    const transfers = parseWanderBunniesPrint(PRINTED_V2).candidates.filter((c) => c.type === 'flight');
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toEqual(expect.objectContaining({ departureDate: '2027-04-05', arrivalDate: '2027-04-06', status: 'Booked', totalCost: 900 }));
  });

  test('reads quoted notes, lodging features, booked-on and status', () => {
    const { candidates } = parseWanderBunniesPrint(PRINTED_V2);
    expect(candidates.find((c) => c.type === 'hotel')).toEqual(expect.objectContaining({
      features: ['Breakfast', 'Dinner'], notes: 'Ask for a private onsen.\n\nSecond paragraph.', status: 'Proposed',
    }));
    expect(candidates.find((c) => c.name === 'Fushimi Inari')).toEqual(expect.objectContaining({
      status: 'Needs Booking', bookedOn: 'Klook', notes: 'Go early; closes at dusk.', location: 'Fushimi, Kyoto',
    }));
  });

  test('keeps a note body whose text starts with a reserved word, a checklist with its state, and a place address', () => {
    const { details } = parseWanderBunniesPrint(PRINTED_V2);
    expect(details.map((d) => d.kind)).toEqual(['note', 'checklist', 'place']);
    expect(details[0]).toEqual(expect.objectContaining({ title: 'Booking priorities', body: '1. Shinkansen\nOTHER: ryokan fills early' }));
    expect(details[1].checklist).toEqual([{ label: 'Reserve table', checked: true }, { label: 'Charge phone', checked: false }]);
    expect(details[2]).toEqual(expect.objectContaining({ title: 'Bar del Pla', time: '19:30', address: 'Carrer 1, Barcelona', lat: 41.4036, lng: 2.1744, coordinateSource: 'manual' }));
  });

  test('reads the UNSCHEDULED section as undated activities', () => {
    const tea = parseWanderBunniesPrint(PRINTED_V2).candidates.find((c) => c.name === 'Tea ceremony');
    expect(tea).toEqual(expect.objectContaining({ unscheduled: true, activityDate: null, status: 'Proposed' }));
  });

  test('stops at the Travel tips boilerplate', () => {
    const { candidates, details } = parseWanderBunniesPrint(PRINTED_V2);
    expect([...candidates.map((c) => c.name), ...details.map((d) => d.title)].join('|')).not.toMatch(/Keep booking|Travel tips/);
  });
});

describe('importing a WanderBunnies printout', () => {
  const trip = { id: 't1', name: 'Spain', destination: 'Spain', startDate: '2026-03-02', endDate: '2026-03-06', notes: '' };
  beforeEach(() => {
    jest.resetAllMocks();
    __clearExtractionCache();
    mockedDb.ensureUserInTrip.mockResolvedValue({ id: 'm1', groupId: 'g1' } as any);
    mockedDb.getTripById.mockResolvedValue(trip as any);
    mockedDb.listFlights.mockResolvedValue([]);
    mockedDb.listLodgings.mockResolvedValue([]);
    mockedDb.listActivities.mockResolvedValue([]);
    mockedDb.listCarRentals.mockResolvedValue([]);
    mockedDb.listItineraries.mockResolvedValue([]);
    mockedDb.insertFlight.mockImplementation(async () => ({ id: `f${Math.random()}` }) as any);
    mockedDb.insertLodging.mockResolvedValue({ id: 'l1' } as any);
    mockedDb.insertActivity.mockImplementation(async () => ({ id: `a${Math.random()}` }) as any);
    mockedDb.insertCarRental.mockResolvedValue({ id: 'c1' } as any);
    mockedDb.createItineraryRecord.mockResolvedValue({ id: 'it1', tripId: 't1' } as any);
    mockedDb.addItineraryDetail.mockImplementation(async (_u, _i, detail) => ({ id: `d${Math.random()}`, ...detail }) as any);
  });

  const run = (dryRun: boolean) => importItineraryDocumentIntoTrip({ tripId: 't1', userId: 'u1', documentText: PRINTED, sourceFilename: 'Spring in Spain.pdf', dryRun });

  test('adds every item type without touching an AI provider', async () => {
    const result = await run(false);
    expect(aiProviderRegistry.resolveProvider).not.toHaveBeenCalled();
    expect(aiProviderConfigService.getActiveAiProvider).not.toHaveBeenCalled();
    expect(result.usage.estimatedCostUsd).toBe(0);
    expect(mockedDb.insertFlight).toHaveBeenCalledTimes(3);
    expect(mockedDb.insertLodging).toHaveBeenCalledTimes(1);
    expect(mockedDb.insertActivity).toHaveBeenCalledTimes(4);
    expect(mockedDb.insertCarRental).toHaveBeenCalledTimes(2);
    expect(mockedDb.addItineraryDetail).toHaveBeenCalledTimes(2);
    expect(result.skippedUnparseable).toEqual([]);
    expect(result.skippedDuplicates).toEqual([]);
    expect(mockedDb.insertFlight).toHaveBeenNthCalledWith(1, expect.objectContaining({
      departureDate: '2026-03-02', arrivalDate: '2026-03-03', bookingReference: 'ZX81QP', passengerName: 'Alex Rivera, Sam Rivera', cost: 812.4,
    }));
    expect(mockedDb.insertFlight).toHaveBeenNthCalledWith(2, expect.objectContaining({ transferType: 'Public Transit', layoverLocation: 'Zaragoza Delicias', layoverDuration: '0h 10m' }));
    expect(mockedDb.insertLodging).toHaveBeenCalledWith(expect.objectContaining({ status: 'Booked', refundBy: '2026-03-02', costPerNight: 180, totalCost: 540 }));
    expect(mockedDb.insertActivity).toHaveBeenCalledWith(expect.objectContaining({ name: 'Park Güell', activityType: 'Outdoor Activity' }));
    expect(mockedDb.insertActivity).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sagrada Familia', activityType: 'Sights & Landmarks', status: 'Booked', freeCancelBy: '2026-03-02', reference: 'SF-2210', cost: 58 }));
    expect(mockedDb.insertCarRental).toHaveBeenCalledWith(expect.objectContaining({ vendor: 'Hertz', model: 'Fiat 500', prepaid: 'No', notes: 'Bring the child seat.', cost: 95 }));
    expect(mockedDb.insertCarRental).toHaveBeenCalledWith(expect.objectContaining({ vendor: 'Avis', model: 'Seat Ibiza', prepaid: 'Yes', notes: 'No smoking.', cost: 80, pickupDate: '2026-03-05', dropoffLocation: 'Madrid Atocha' }));
    expect(mockedDb.addItineraryDetail).toHaveBeenCalledWith('u1', 'it1', expect.objectContaining({ day: 3, kind: 'place', activity: 'Bar del Pla', time: '19:30', cost: 40 }));
    expect(mockedDb.addItineraryDetail).toHaveBeenCalledWith('u1', 'it1', expect.objectContaining({ kind: 'checklist', checklistItems: [{ label: 'Passports', position: 0 }, { label: 'Chargers', position: 1 }] }));
  });

  test('restores coordinates and their source on the items that had them', async () => {
    mockedDb.insertLodging.mockResolvedValue({ id: 'l1' } as any);
    mockedDb.insertActivity.mockImplementation(async (activity: any) => ({ id: `a-${activity.name}-${activity.startTime}` }) as any);
    mockedDb.insertCarRental.mockImplementation(async (rental: any) => ({ id: `c-${rental.vendor}` }) as any);
    const result = await run(false);
    expect(mockedDb.setItemCoordinates).toHaveBeenCalledTimes(3);
    expect(mockedDb.setItemCoordinates).toHaveBeenCalledWith('u1', 'lodging', 'l1', expect.objectContaining({ lat: 41.4036, lng: 2.1744, coordinateSource: 'manual' }));
    expect(mockedDb.setItemCoordinates).toHaveBeenCalledWith('u1', 'activity', 'a-Sagrada Familia-10:00', expect.objectContaining({ lat: 41.40363, lng: 2.17436, coordinateSource: 'catalog' }));
    expect(mockedDb.setItemCoordinates).toHaveBeenCalledWith('u1', 'car_rental', 'c-Avis', expect.objectContaining({
      lat: 41.379, lng: 2.14, dropoffLat: 40.4065, dropoffLng: -3.6895, coordinateSource: 'geocoder',
    }));
    expect(result.warnings).toBeUndefined();
  });

  test('a failed coordinate save still adds the item and says so', async () => {
    mockedDb.setItemCoordinates.mockRejectedValue(new Error('storage down'));
    const result = await run(false);
    expect(result.added).toHaveLength(3 + 1 + 4 + 2 + 2);
    expect(result.warnings).toEqual(['Some map locations could not be saved; those items were still added without a map pin.']);
  });

  test('warns, without converting, when the printout is in another currency than the trip', async () => {
    mockedDb.getTripById.mockResolvedValue({ ...trip, currency: 'EUR' } as any);
    const result = await run(true);
    expect(result.warnings).toEqual([expect.stringMatching(/USD.*EUR.*not converted/)]);
    mockedDb.getTripById.mockResolvedValue({ ...trip, currency: 'usd' } as any);
    expect((await run(true)).warnings).toBeUndefined();
  });

  test('a preview lists the same items and writes nothing', async () => {
    const result = await run(true);
    expect(result.added).toHaveLength(3 + 1 + 4 + 2 + 2);
    expect(mockedDb.setItemCoordinates).not.toHaveBeenCalled();
    expect(mockedDb.insertFlight).not.toHaveBeenCalled();
    expect(mockedDb.addItineraryDetail).not.toHaveBeenCalled();
    expect(mockedDb.createItineraryRecord).not.toHaveBeenCalled();
  });

  test('importing the same printout again adds nothing', async () => {
    mockedDb.listFlights.mockResolvedValue([
      { id: 'f1', departureDate: '2026-03-02', departureLocation: 'BOS', arrivalLocation: 'MAD', departureTime: '20:00' },
      { id: 'f2', departureDate: '2026-03-03', departureLocation: 'Madrid Atocha', arrivalLocation: 'Barcelona Sants', departureTime: '14:00' },
      { id: 'f3', departureDate: '2026-03-06', departureLocation: 'MAD', arrivalLocation: 'BOS', departureTime: '11:00' },
    ] as any);
    mockedDb.listLodgings.mockResolvedValue([{ id: 'l1', name: 'Hotel Gracia Norte', check_in_date: '2026-03-03', check_out_date: '2026-03-06', address: '' }] as any);
    mockedDb.listActivities.mockResolvedValue([
      { id: 'a1', name: 'Sagrada Familia', date: '2026-03-03', startTime: '10:00' },
      { id: 'a2', name: 'Mercat de la Boqueria', date: '2026-03-04', startTime: '9:00' },
      { id: 'a3', name: 'Mercat de la Boqueria', date: '2026-03-04', startTime: '18:30' },
      { id: 'a4', name: 'Park Güell', date: '2026-03-04', startTime: '' },
    ] as any);
    mockedDb.listCarRentals.mockResolvedValue([
      { id: 'c1', pickupDate: '2026-03-04', vendor: 'Hertz', pickupLocation: 'Barcelona Airport' },
      { id: 'c2', pickupDate: '2026-03-05', vendor: 'Avis', pickupLocation: 'Barcelona Sants' },
    ] as any);
    mockedDb.listItineraries.mockResolvedValue([{ id: 'it1', tripId: 't1' }] as any);
    mockedDb.listItineraryDetails.mockResolvedValue([
      { id: 'd1', day: 3, kind: 'place', activity: 'Bar del Pla' },
      { id: 'd2', day: 3, kind: 'checklist', activity: 'Packing' },
    ] as any);
    const result = await run(false);
    expect(result.added).toEqual([]);
    expect(result.skippedDuplicates).toHaveLength(3 + 1 + 4 + 2 + 2);
    expect(mockedDb.insertFlight).not.toHaveBeenCalled();
  });
});

describe('importing a format-v2 printout', () => {
  const trip = { id: 't1', name: 'Japan', destination: 'Japan', startDate: '2027-04-05', endDate: '2027-04-07', notes: 'My own note.' };
  beforeEach(() => {
    jest.resetAllMocks();
    __clearExtractionCache();
    mockedDb.ensureUserInTrip.mockResolvedValue({ id: 'm1', groupId: 'g1' } as any);
    mockedDb.getTripById.mockResolvedValue(trip as any);
    mockedDb.listFlights.mockResolvedValue([]);
    mockedDb.listLodgings.mockResolvedValue([]);
    mockedDb.listActivities.mockResolvedValue([]);
    mockedDb.listCarRentals.mockResolvedValue([]);
    mockedDb.listItineraries.mockResolvedValue([]);
    mockedDb.insertFlight.mockResolvedValue({ id: 'f1' } as any);
    mockedDb.insertLodging.mockResolvedValue({ id: 'l1' } as any);
    mockedDb.insertActivity.mockImplementation(async (activity: any) => ({ id: `a-${activity.name}` }) as any);
    mockedDb.createItineraryRecord.mockResolvedValue({ id: 'it1', tripId: 't1' } as any);
    mockedDb.addItineraryDetail.mockImplementation(async (_u, _i, detail: any) => ({
      id: `d-${detail.activity}`, ...detail,
      checklistItems: (detail.checklistItems ?? []).map((item: any, index: number) => ({ id: `c${index}`, ...item })),
    }) as any);
  });
  const run = (dryRun: boolean) => importItineraryDocumentIntoTrip({ tripId: 't1', userId: 'u1', documentText: PRINTED_V2, sourceFilename: 'japan.pdf', dryRun });

  test('keeps notes, features, booked-on, status and the undated activity', async () => {
    const result = await run(false);
    expect(result.skippedUnparseable).toEqual([]);
    expect(mockedDb.insertFlight).toHaveBeenCalledTimes(1);
    expect(mockedDb.insertFlight).toHaveBeenCalledWith(expect.objectContaining({ status: 'Booked', departureDate: '2027-04-05', arrivalDate: '2027-04-06' }));
    expect(mockedDb.insertLodging).toHaveBeenCalledWith(expect.objectContaining({ features: ['Breakfast', 'Dinner'], notes: 'Ask for a private onsen.\n\nSecond paragraph.' }));
    expect(mockedDb.insertActivity).toHaveBeenCalledWith(expect.objectContaining({ name: 'Fushimi Inari', status: 'Needs Booking', bookedOn: 'Klook', notes: 'Go early; closes at dusk.' }));
    expect(mockedDb.insertActivity).toHaveBeenCalledWith(expect.objectContaining({ name: 'Tea ceremony', date: '' }));
  });

  test('writes note bodies, a place\'s address and checked checklist entries', async () => {
    await run(false);
    expect(mockedDb.addItineraryDetail).toHaveBeenCalledWith('u1', 'it1', expect.objectContaining({ kind: 'note', activity: 'Booking priorities', noteBody: '1. Shinkansen\nOTHER: ryokan fills early' }));
    expect(mockedDb.addItineraryDetail).toHaveBeenCalledWith('u1', 'it1', expect.objectContaining({ kind: 'place', noteBody: 'Address: Carrer 1, Barcelona\nCoordinates: 41.4036, 2.1744' }));
    expect(mockedDb.updateItineraryChecklistItem).toHaveBeenCalledTimes(1);
    expect(mockedDb.updateItineraryChecklistItem).toHaveBeenCalledWith('u1', 'c0', { checked: true });
  });

  test('appends trip notes and the trip guide without touching existing notes', async () => {
    const result = await run(false);
    expect(result.notesAppended).toBe(true);
    const saved = (mockedDb.updateTripDetails.mock.calls[0][2] as any).notes as string;
    expect(saved.startsWith('My own note.')).toBe(true);
    expect(saved).toContain('### Imported from japan.pdf');
    expect(saved).toContain('Book the Shinkansen first.');
    expect(saved).toContain('### Trip guide (imported from japan.pdf');
    expect(saved).toContain('Day one is a long travel day.');
  });

  test('a preview reports the same items by kind and writes nothing', async () => {
    const result = await run(true);
    expect(result.added.map((item) => item.type)).toEqual(expect.arrayContaining(['flight', 'hotel', 'tour_activity', 'note', 'checklist', 'place']));
    expect(mockedDb.insertActivity).not.toHaveBeenCalled();
    expect(mockedDb.updateTripDetails).not.toHaveBeenCalled();
    expect(result.notesPreview).toContain('Trip guide');
  });
});

describe('duplicate matching for transfers and activities', () => {
  const none = { flights: [], lodgings: [], activities: [], carRentals: [] };

  test('two trains into the same hub at different times are different trips', () => {
    const candidate = { type: 'rail' as const, departureDate: '2026-11-19', departureLocation: 'Nagiso Station', arrivalLocation: 'Nagoya Station', departureTime: '14:00' };
    const sameHubLater = { departureDate: '2026-11-19', departureLocation: 'Gifu Station', arrivalLocation: 'Nagoya Station', departureTime: '17:30' };
    expect(isDuplicateItineraryCandidate(candidate, { ...none, flights: [sameHubLater] })).toBe(false);
    expect(isDuplicateItineraryCandidate(candidate, { ...none, flights: [{ ...sameHubLater, departureTime: '14:00' }] })).toBe(true);
    expect(isDuplicateItineraryCandidate(candidate, { ...none, flights: [{ ...sameHubLater, departureTime: '' }] })).toBe(true);
  });

  test('the same place at two times on one day is two activities', () => {
    const existing = { ...none, activities: [{ name: 'Momiji Corridor', date: '2026-11-12', startTime: '13:30' }] };
    expect(isDuplicateItineraryCandidate({ type: 'tour_activity', name: 'Momiji Corridor', activityDate: '2026-11-12', activityTime: '17:30' }, existing)).toBe(false);
    expect(isDuplicateItineraryCandidate({ type: 'tour_activity', name: 'Momiji Corridor', activityDate: '2026-11-12', activityTime: '13:30' }, existing)).toBe(true);
    expect(isDuplicateItineraryCandidate({ type: 'tour_activity', name: 'Momiji Corridor', activityDate: '2026-11-12' }, existing)).toBe(true);
  });
});
