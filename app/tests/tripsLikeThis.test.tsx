import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import TripsLikeThis from '../components/TripsLikeThis';
import ActivitySharingControls from '../components/ActivitySharingControls';

const source = { username: 'author', tripSlug: 'paris', title: 'Paris ideas', sourcePath: '/author/paris',
  activities: [{ id: 'activity-1', catalogId: 'catalog-1', name: 'Public Garden', activityType: 'Tour', duration: '60 min' }] };
const json = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body }) as Response;
const props = { tripId: 'target', date: '2027-05-02', backendUrl: 'https://api.test', headers: { Authorization: 'Bearer one' }, onAdded: jest.fn() };
describe('Trips like this and sharing controls', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.clearAllMocks(); });
  it('uses only source identifiers for copies and preserves the operation key on retry', async () => {
    let attempts = 0;
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('planning-capabilities')) return json({ inspiration: true });
      if (url.endsWith('similar-trips')) return json({ trips: [source] });
      if (url.endsWith('/api/activities')) { attempts++; return attempts === 1 ? json({ error: 'Try again' }, 503) : json({ id: 'copy-1' }); }
      if (init?.method === 'DELETE') return json({});
      throw new Error(url);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const view = render(<TripsLikeThis {...props} />);
    await waitFor(() => expect(view.getByText('Copy to 2027-05-02')).toBeTruthy());
    fireEvent.press(view.getByText('Copy to 2027-05-02'));
    await waitFor(() => expect(view.getByText('Try again')).toBeTruthy());
    fireEvent.press(view.getByText('Copy to 2027-05-02'));
    await waitFor(() => expect(view.getByText('Added · Undo')).toBeTruthy());
    const writes = fetchMock.mock.calls.filter(([url]) => url.endsWith('/api/activities'));
    expect(writes).toHaveLength(2);
    expect(JSON.parse(String(writes[0][1]!.body))).toEqual({ tripId: 'target', date: '2027-05-02', publicSource: { username: 'author', tripSlug: 'paris', activityId: 'activity-1' } });
    expect(writes[0][1]!.headers).toEqual(writes[1][1]!.headers);
    expect(props.onAdded).toHaveBeenCalledTimes(1);
    fireEvent.press(view.getByText('Added · Undo'));
    await waitFor(() => expect(view.getByText('The copied activity was removed.')).toBeTruthy());
  });
  it('ignores an old account/trip response and hides unavailable recommendations', async () => {
    let release: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>(resolve => { release = resolve; });
    global.fetch = jest.fn(async (url: string) => url.endsWith('planning-capabilities') ? json({ inspiration: true }) : url.includes('/target/') ? pending : json({ trips: [] })) as unknown as typeof fetch;
    const view = render(<TripsLikeThis {...props} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    view.rerender(<TripsLikeThis {...props} tripId="other-trip" headers={{ Authorization: 'Bearer two' }} />);
    await waitFor(() => expect(view.getByText(/No shared activities/)).toBeTruthy());
    await act(async () => { release(json({ trips: [source] })); });
    expect(view.queryByText('Paris ideas · Source blog')).toBeNull();
  });
  it('shows no surface or browse call when the capability is disabled', async () => {
    global.fetch = jest.fn(async () => json({ inspiration: false }));
    const view = render(<TripsLikeThis {...props} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(view.queryByText('Trips like this')).toBeNull();
  });
  it('requires the sharing preview before enabling and allows withdrawing consent', async () => {
    const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => init?.method === 'PUT' ? json({ enabled: JSON.parse(String(init.body)).enabled }) : json({ enabled: false, activities: source.activities }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const view = render(<ActivitySharingControls tripId="source" backendUrl="https://api.test" headers={{ Authorization: 'Bearer owner' }} />);
    await waitFor(() => expect(view.getByText('Preview activity sharing')).toBeTruthy());
    expect(view.queryByText('Allow travelers to copy these activity ideas')).toBeNull();
    fireEvent.press(view.getByText('Preview activity sharing'));
    expect(view.getByText('Public Garden · Tour · 60 min')).toBeTruthy();
    fireEvent.press(view.getByText('Allow travelers to copy these activity ideas'));
    await waitFor(() => expect(view.getByText('Share activity ideas: On')).toBeTruthy());
    fireEvent.press(view.getByText('Stop sharing activity ideas'));
    await waitFor(() => expect(view.getByText('Share activity ideas: Off')).toBeTruthy());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT').map(([, init]) => JSON.parse(String(init!.body)).enabled)).toEqual([true, false]);
  });
});
