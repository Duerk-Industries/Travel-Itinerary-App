import { reconcileTravelDayNotes } from '../src/services/itineraryPromptPlanService';
import { __testing, cancelAsyncItineraryJob, type AsyncItineraryJob } from '../src/services/itineraryAsyncService';

const day = (it: unknown[], ln: string[]) => ({ d: 1, dt: '2027-05-01', b: 'Lisbon', it, ln }) as any;

describe('R3: day summary matches the day', () => {
  it('removes "no activities scheduled" from a day that has activities, keeping its other notes', () => {
    const itinerary = { dy: [
      day([['10:00', 'x', 'Belém Tower']], ['Travel day: no activities scheduled; allow terminal, transfer, check-in, and recovery time.']),
      day([['10:00', 'x', 'Alfama']], ['Departure day: protect at least 180 minutes for checkout. Travel day: no activities scheduled.']),
    ] } as any;
    reconcileTravelDayNotes(itinerary);
    expect(itinerary.dy[0].ln.join(' ')).not.toMatch(/no activities scheduled/i);
    expect(itinerary.dy[0].ln[0]).toBe('allow terminal, transfer, check-in, and recovery time.');
    expect(itinerary.dy[1].ln).toEqual(['Departure day: protect at least 180 minutes for checkout.']);
  });

  it('keeps the wording on a day that really has nothing scheduled', () => {
    const itinerary = { dy: [day([], ['Travel day: no activities scheduled.'])] } as any;
    reconcileTravelDayNotes(itinerary);
    expect(itinerary.dy[0].ln).toEqual(['Travel day: no activities scheduled.']);
  });
});

describe('R3: cancelling a generation', () => {
  const job = (overrides: Partial<AsyncItineraryJob> = {}): AsyncItineraryJob => ({
    id: 'job-r3', userId: 'u1', tripId: 't1', status: 'running', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...overrides,
  });
  afterEach(() => { __testing.jobs.clear(); });

  it('marks a running job cancelled so the runner saves nothing', () => {
    __testing.jobs.set('job-r3', job());
    const cancelled = cancelAsyncItineraryJob('job-r3', 'u1');
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelRequested: true, error: 'Cancelled', etaSeconds: null });
  });

  it('refuses another user and leaves a finished job alone', () => {
    __testing.jobs.set('job-r3', job());
    expect(cancelAsyncItineraryJob('job-r3', 'someone-else')).toBeNull();
    expect(__testing.jobs.get('job-r3')?.status).toBe('running');
    __testing.jobs.set('job-r3', job({ status: 'completed' }));
    expect(cancelAsyncItineraryJob('job-r3', 'u1')?.status).toBe('completed');
  });
});
