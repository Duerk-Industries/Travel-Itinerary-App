/**
 * The most important test in the feature (per the implementation plan's own
 * test-coverage standard): asserts each action-mode tool dispatches through
 * the correct existing fetch helper with correctly-mapped arguments, never
 * a new/parallel implementation. Mocks the fetch helpers themselves, not
 * the network -- consistent with how activities.tsx's own tests mock at
 * the fetch-helper boundary.
 */
jest.mock('../tabs/activities', () => ({
  ...jest.requireActual('../tabs/activities'),
  createActivityForTrip: jest.fn(),
  updateActivityStatus: jest.fn(),
}));

import { createActivityForTrip, updateActivityStatus } from '../tabs/activities';
import { ACTION_DISPATCH, type ActionDispatchContext } from '../utils/assistantTools';

const mockedCreateActivityForTrip = createActivityForTrip as jest.Mock;
const mockedUpdateActivityStatus = updateActivityStatus as jest.Mock;

const CTX: ActionDispatchContext = {
  backendUrl: 'https://wanderbunnies.test',
  jsonHeaders: { Authorization: 'Bearer token' },
  activeTripId: 'trip-1',
  defaultPayerId: 'member-1',
};

describe('ACTION_DISPATCH.addActivity', () => {
  beforeEach(() => {
    mockedCreateActivityForTrip.mockReset();
    mockedCreateActivityForTrip.mockResolvedValue({ ok: true });
  });

  it('maps the model args onto a TourDraft and calls createActivityForTrip with the unchanged context', async () => {
    const result = await ACTION_DISPATCH.addActivity(
      { name: 'Walking tour of the Colosseum', date: '2026-04-12', startLocation: 'Colosseum', startTime: '10:00', duration: '2h' },
      CTX
    );
    expect(result).toEqual({ ok: true });
    expect(mockedCreateActivityForTrip).toHaveBeenCalledTimes(1);
    const call = mockedCreateActivityForTrip.mock.calls[0][0];
    expect(call.backendUrl).toBe(CTX.backendUrl);
    expect(call.jsonHeaders).toBe(CTX.jsonHeaders);
    expect(call.activeTripId).toBe(CTX.activeTripId);
    expect(call.defaultPayerId).toBe(CTX.defaultPayerId);
    expect(call.draft).toMatchObject({
      name: 'Walking tour of the Colosseum',
      date: '2026-04-12',
      startLocation: 'Colosseum',
      startTime: '10:00',
      duration: '2h',
    });
  });

  it('fails cleanly without calling createActivityForTrip when the model omitted a required field', async () => {
    const result = await ACTION_DISPATCH.addActivity({ name: '', date: '2026-04-12' }, CTX);
    expect(result.ok).toBe(false);
    expect(mockedCreateActivityForTrip).not.toHaveBeenCalled();
  });

  it('fails cleanly without calling createActivityForTrip when the date is missing/invalid', async () => {
    const result = await ACTION_DISPATCH.addActivity({ name: 'Louvre tour', date: 'next tuesday' }, CTX);
    expect(result.ok).toBe(false);
    expect(mockedCreateActivityForTrip).not.toHaveBeenCalled();
  });
});

describe('ACTION_DISPATCH.updateItineraryStatus', () => {
  beforeEach(() => {
    mockedUpdateActivityStatus.mockReset();
    mockedUpdateActivityStatus.mockResolvedValue({ ok: true });
  });

  it('calls updateActivityStatus with the resolved activity id, never the model\'s itemName', async () => {
    const result = await ACTION_DISPATCH.updateItineraryStatus(
      { itemName: 'the Eiffel Tower tour', status: 'Booked', resolvedActivityId: 'activity-42' },
      CTX
    );
    expect(result).toEqual({ ok: true });
    expect(mockedUpdateActivityStatus).toHaveBeenCalledWith({
      backendUrl: CTX.backendUrl,
      jsonHeaders: CTX.jsonHeaders,
      activeTripId: CTX.activeTripId,
      activityId: 'activity-42',
      status: 'Booked',
    });
  });

  it('never dispatches without a resolved activity id -- the model\'s itemName is never trusted as an id', async () => {
    const result = await ACTION_DISPATCH.updateItineraryStatus({ itemName: 'the Eiffel Tower tour', status: 'Booked' }, CTX);
    expect(result.ok).toBe(false);
    expect(mockedUpdateActivityStatus).not.toHaveBeenCalled();
  });

  it('normalizes an unrecognized status value rather than passing it through unchecked', async () => {
    await ACTION_DISPATCH.updateItineraryStatus({ status: 'not-a-real-status', resolvedActivityId: 'activity-1' }, CTX);
    expect(mockedUpdateActivityStatus).toHaveBeenCalledTimes(1);
    const call = mockedUpdateActivityStatus.mock.calls[0][0];
    expect(['Needed', 'Proposed', 'Booked', 'Cancelled', 'Completed']).toContain(call.status);
  });
});
