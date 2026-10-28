/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import TripTemplatePicker, { destinationQuery } from '../components/TripTemplatePicker';
import { CHOOSE_HOTEL_FEATURE, needsHotelChoice, withoutHotelPlaceholder } from '../utils/lodgingPlaceholder';

const styles: Record<string, any> = new Proxy({}, { get: () => ({}) });
const json = (body: unknown, ok = true, status = 200) => Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
const japan = [{ id: 'country:japan', name: 'Japan', sourceType: 'country' }];

const TEMPLATE = {
  id: 'japan-t01', title: 'Classic Tokyo & Kyoto - 7 days', summary: 'The classic first trip.', days: 7, route: 'Tokyo > Kyoto',
  cities: ['Tokyo', 'Kyoto'], highlights: ['Nara day trip', 'Fushimi Inari torii gate hike'], imageQuery: 'Kyoto Japan temple',
};
const DETAIL = {
  ...TEMPLATE,
  preview: [
    { day: 1, base: 'Tokyo', items: [{ kind: 'stay', time: '', title: 'Check in: Hotel in Tokyo', detail: '3 nights', needsBooking: false }] },
    { day: 2, base: 'Tokyo', items: [{ kind: 'activity', time: '09:00', title: 'Senso-ji Temple', detail: '2h', needsBooking: true }] },
  ],
};

const installFetch = (opts: { templates?: unknown[]; created?: { ok: boolean; body: unknown; status?: number } } = {}) => {
  const fn = jest.fn((url: string, init?: RequestInit) => {
    if (url.includes('/api/itinerary/images')) return json({ url: 'https://img.test/kyoto.jpg', provider: 'unsplash' });
    if (init?.method === 'POST') return json(opts.created?.body ?? { trip: { id: 'trip-9' } }, opts.created?.ok ?? true, opts.created?.status ?? 201);
    if (/\/api\/trip-templates\/japan-t01$/.test(url)) return json(DETAIL);
    if (url.includes('/api/trip-templates?')) return json({ templates: opts.templates ?? [TEMPLATE] });
    return json({}, false, 404);
  });
  (global as any).fetch = fn;
  return fn;
};

const renderPicker = (props: Partial<React.ComponentProps<typeof TripTemplatePicker>> = {}) =>
  render(
    <TripTemplatePicker backendUrl="http://api" headers={{ Authorization: 'Bearer t' }} selectedLocations={japan} startDate="2027-04-05" tripName="Spring in Japan"
      styles={styles} onCreated={jest.fn()} {...props} />
  );

describe('destinationQuery', () => {
  it('sends ids plus the country and city names the search results carry', () => {
    const query = new URLSearchParams(destinationQuery([
      { id: 'country:japan', name: 'Japan', sourceType: 'country' },
      { id: 'dest:kyoto', name: 'Kyoto', sourceType: 'destination', countryName: 'Japan' },
    ]));
    expect(query.get('locationIds')).toBe('country:japan,dest:kyoto');
    expect(query.get('countries')).toBe('Japan');
    expect(query.get('cities')).toBe('Kyoto');
    expect(query.get('maxDays')).toBeNull();
    expect(new URLSearchParams(destinationQuery([{ id: 'country:japan', name: 'Japan', sourceType: 'country' }], 7)).get('maxDays')).toBe('7');
  });
});

describe('TripTemplatePicker', () => {
  afterEach(() => { (global as any).fetch = undefined; });

  it('shows nothing, and asks for nothing, before a destination is chosen', async () => {
    const fn = installFetch();
    const { queryByTestId } = renderPicker({ selectedLocations: [] });
    await act(async () => { await Promise.resolve(); });
    expect(queryByTestId('trip-templates')).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('shows nothing when no template is aligned with the destination', async () => {
    installFetch({ templates: [] });
    const { queryByTestId } = renderPicker();
    await act(async () => { await Promise.resolve(); });
    expect(queryByTestId('trip-templates')).toBeNull();
  });

  it('lists the templates for the chosen destination, with a picture when one is available', async () => {
    const fn = installFetch();
    const { findByTestId, findByText, UNSAFE_getAllByType } = renderPicker();
    expect(await findByTestId('trip-template-card-japan-t01')).toBeTruthy();
    expect(await findByText('Classic Tokyo & Kyoto - 7 days')).toBeTruthy();
    expect(await findByText('Nara day trip')).toBeTruthy();
    expect(String(fn.mock.calls[0][0])).toContain('/api/trip-templates?locationIds=country%3Ajapan&countries=Japan');
    const { Image } = require('react-native');
    await waitFor(() => expect(UNSAFE_getAllByType(Image).length).toBeGreaterThan(0));
  });

  it('leaves the card as text when there is no picture', async () => {
    const fn = installFetch();
    fn.mockImplementation((url: string) => (String(url).includes('/api/itinerary/images') ? json({ url: 'x', provider: 'placeholder' }) : json({ templates: [TEMPLATE] })));
    const { findByTestId, UNSAFE_queryAllByType } = renderPicker();
    await findByTestId('trip-template-card-japan-t01');
    await act(async () => { await Promise.resolve(); });
    const { Image } = require('react-native');
    expect(UNSAFE_queryAllByType(Image)).toHaveLength(0);
  });

  it('previews day by day and creates the trip from the start date already entered', async () => {
    const onCreated = jest.fn();
    const fn = installFetch();
    const { findByTestId, findByText } = renderPicker({ onCreated });
    fireEvent.press(await findByTestId('trip-template-card-japan-t01'));
    expect(await findByText('Check in: Hotel in Tokyo')).toBeTruthy();
    expect(await findByText('Book ahead')).toBeTruthy();
    expect(await findByText('2027-04-05 to 2027-04-11')).toBeTruthy();
    await act(async () => { fireEvent.press(await findByTestId('trip-template-use-japan-t01')); });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('trip-9'));
    const post = fn.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')!;
    expect(String(post[0])).toBe('http://api/api/trip-templates/japan-t01/trip');
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ name: 'Spring in Japan', startDate: '2027-04-05', locationIds: ['country:japan'], participants: [] });
  });

  it('asks for a start date or a long enough trip when neither is known', async () => {
    const fn = installFetch();
    const { findByTestId } = renderPicker({ startDate: '', tripDays: 5 });
    fireEvent.press(await findByTestId('trip-template-card-japan-t01'));
    expect(await findByTestId('trip-template-needs-date')).toBeTruthy();
    fireEvent.press(await findByTestId('trip-template-use-japan-t01'));
    expect(fn.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'POST')).toBe(false);
  });

  it('asks the server only for templates that fit the trip length', async () => {
    const fn = installFetch();
    const { findByTestId } = renderPicker({ startDate: '', tripDays: 10 });
    await findByTestId('trip-template-card-japan-t01');
    expect(String(fn.mock.calls[0][0])).toContain('maxDays=10');
  });

  it('uses a template with only a trip length, and says the days are not dated', async () => {
    const onCreated = jest.fn();
    const fn = installFetch();
    const { findByTestId } = renderPicker({ startDate: '', tripDays: 10, onCreated });
    fireEvent.press(await findByTestId('trip-template-card-japan-t01'));
    expect(await findByTestId('trip-template-undated')).toBeTruthy();
    await act(async () => { fireEvent.press(await findByTestId('trip-template-use-japan-t01')); });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('trip-9'));
    const post = fn.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ name: 'Spring in Japan', durationDays: 10, locationIds: ['country:japan'], participants: [] });
  });

  it("keeps the trip's own later end date when it is longer than the template", async () => {
    const fn = installFetch();
    const { findByTestId, findByText } = renderPicker({ startDate: '2027-04-05', endDate: '2027-04-15', tripDays: 11 });
    fireEvent.press(await findByTestId('trip-template-card-japan-t01'));
    expect(await findByText('2027-04-05 to 2027-04-15')).toBeTruthy();
    await act(async () => { fireEvent.press(await findByTestId('trip-template-use-japan-t01')); });
    const post = fn.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toMatchObject({ startDate: '2027-04-05', endDate: '2027-04-15' });
  });

  it('shows the server message and keeps the preview open when creation is refused', async () => {
    const onCreated = jest.fn();
    installFetch({ created: { ok: false, status: 402, body: { error: 'You have reached the active trip limit.' } } });
    const { findByTestId, findByText } = renderPicker({ onCreated });
    fireEvent.press(await findByTestId('trip-template-card-japan-t01'));
    await findByText('Check in: Hotel in Tokyo');
    await act(async () => { fireEvent.press(await findByTestId('trip-template-use-japan-t01')); });
    expect(await findByText('You have reached the active trip limit.')).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe('hotel placeholder', () => {
  it('is recognised by its feature tag', () => {
    expect(needsHotelChoice({ features: ['Breakfast', CHOOSE_HOTEL_FEATURE] })).toBe(true);
    expect(needsHotelChoice({ features: ['Breakfast'] })).toBe(false);
    expect(needsHotelChoice(undefined)).toBe(false);
  });

  it('is dropped when the stay is saved, leaving other features alone', () => {
    expect(withoutHotelPlaceholder({ name: 'Hotel Granvia', features: ['Breakfast', CHOOSE_HOTEL_FEATURE] })).toEqual({ name: 'Hotel Granvia', features: ['Breakfast'] });
    const untouched = { name: 'x', features: ['Pool'] };
    expect(withoutHotelPlaceholder(untouched)).toBe(untouched);
  });
});
