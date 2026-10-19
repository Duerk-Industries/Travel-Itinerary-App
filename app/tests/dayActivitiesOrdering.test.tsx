/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { Text, View } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import DayActivitiesOrdering, { type OrderableActivity } from '../components/DayActivitiesOrdering';

type Reply = { status?: number; body?: unknown };
const json = ({ status = 200, body = {} }: Reply): Response =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;

const styles = {};

// West → east. The saved order zig-zags: far east, west, east, mid.
const A: OrderableActivity = { id: 'a', name: 'Far East Tower', lat: 35.68, lng: 140.1, dayPosition: 0, status: 'Proposed' };
const B: OrderableActivity = { id: 'b', name: 'West Garden', lat: 35.68, lng: 139.5, dayPosition: 1, status: 'Proposed' };
const C: OrderableActivity = { id: 'c', name: 'East Market', lat: 35.68, lng: 139.9, dayPosition: 2, status: 'Proposed' };
const D: OrderableActivity = { id: 'd', name: 'Mid Temple', lat: 35.68, lng: 139.7, dayPosition: 3, status: 'Proposed' };

type FetchHandler = (url: string, init?: RequestInit) => Reply | Promise<Reply> | never;

const setup = (opts: { activities?: OrderableActivity[]; capability?: boolean; onPut?: FetchHandler; readOnly?: boolean; lodging?: { lat: number; lng: number } | null } = {}) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes('/planning-capabilities')) return json({ body: { dayOrder: opts.capability ?? true } });
    if (url.endsWith('/api/activities/day-order')) {
      if (!opts.onPut) return json({ body: { order: [] } });
      return json(await opts.onPut(url, init));
    }
    return json({ status: 404 });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  const onChanged = jest.fn();
  const activities = opts.activities ?? [A, B, C, D];
  const utils = render(
    <DayActivitiesOrdering
      tripId="trip-1"
      date="2027-05-02"
      backendUrl="https://api.example.com"
      headers={{ Authorization: 'Bearer t' }}
      activities={activities}
      lodgingAnchor={opts.lodging}
      readOnly={opts.readOnly}
      onChanged={onChanged}
      styles={styles}
      renderRow={(activity, controls) => (
        <View key={activity.id} testID={`row-${activity.id}`}>
          <Text>{activity.name}</Text>
          {controls}
        </View>
      )}
    />,
  );
  const puts = () => calls.filter((c) => c.url.endsWith('/api/activities/day-order'));
  const body = (i = 0) => JSON.parse(String(puts()[i]!.init!.body));
  return { ...utils, calls, onChanged, puts, body };
};

describe('DayActivitiesOrdering', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('lists activities in saved-position order and shows no controls until the rollout flag is on', async () => {
    const off = setup({ capability: false });
    await waitFor(() => expect(off.calls.some((c) => c.url.includes('planning-capabilities'))).toBe(true));
    expect(off.getByTestId('row-a')).toBeTruthy();
    expect(off.queryByTestId('day-order-optimize')).toBeNull();
    expect(off.queryByTestId('day-order-up-b')).toBeNull();
  });

  it('shows nothing extra for read-only viewers (followers, offline) and never asks the server', () => {
    const view = setup({ readOnly: true });
    expect(view.queryByTestId('day-order-tools')).toBeNull();
    expect(view.calls).toHaveLength(0);
  });

  it('moves a stop down with the order the user was looking at as the expected order', async () => {
    const view = setup({ onPut: () => ({ body: { order: [] } }) });
    await waitFor(() => expect(view.getByTestId('day-order-down-a')).toBeTruthy());
    fireEvent.press(view.getByTestId('day-order-down-a'));
    await waitFor(() => expect(view.puts()).toHaveLength(1));
    expect(view.body()).toEqual({ tripId: 'trip-1', date: '2027-05-02', expectedIds: ['a', 'b', 'c', 'd'], orderedIds: ['b', 'a', 'c', 'd'] });
    await waitFor(() => expect(view.onChanged).toHaveBeenCalled());
    expect(view.getByTestId('day-order-notice').props.children).toBe('Moved Far East Tower down.');
  });

  it('disables Move up on the first row and Move down on the last, with accessible labels', async () => {
    const view = setup();
    await waitFor(() => expect(view.getByTestId('day-order-up-a')).toBeTruthy());
    expect(view.getByTestId('day-order-up-a').props.accessibilityState.disabled).toBe(true);
    expect(view.getByTestId('day-order-down-d').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('Move East Market up')).toBeTruthy();
    expect(view.getByLabelText('Move East Market down')).toBeTruthy();
  });

  it('previews a shorter order with distances, saves it only after the user agrees, and then offers Undo', async () => {
    const view = setup({ onPut: () => ({ body: { order: [] } }) });
    await waitFor(() => expect(view.getByTestId('day-order-optimize')).toBeTruthy());
    fireEvent.press(view.getByTestId('day-order-optimize'));

    const preview = view.getByTestId('day-order-preview');
    expect(preview).toBeTruthy();
    expect(view.getByText(/Straight-line distance:/)).toBeTruthy();
    expect(view.getByText(/not walking or driving times/)).toBeTruthy();
    expect(view.puts()).toHaveLength(0); // previewing never writes

    fireEvent.press(view.getByTestId('day-order-apply'));
    await waitFor(() => expect(view.puts()).toHaveLength(1));
    expect(view.body().expectedIds).toEqual(['a', 'b', 'c', 'd']);
    expect(view.body().orderedIds).toHaveLength(4);
    expect([...view.body().orderedIds].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(view.body().orderedIds).not.toEqual(['a', 'b', 'c', 'd']);
    await waitFor(() => expect(view.getByTestId('day-order-undo')).toBeTruthy());

    // Undo restores the previous order and is itself checked against the applied order.
    const applied = view.body().orderedIds as string[];
    fireEvent.press(view.getByTestId('day-order-undo'));
    await waitFor(() => expect(view.puts()).toHaveLength(2));
    expect(view.body(1)).toEqual({ tripId: 'trip-1', date: '2027-05-02', expectedIds: applied, orderedIds: ['a', 'b', 'c', 'd'] });
    await waitFor(() => expect(view.getByTestId('day-order-notice').props.children).toBe('Your previous order is back.'));
    expect(view.queryByTestId('day-order-undo')).toBeNull();
  });

  it('lets the user dismiss a suggestion without changing anything', async () => {
    const view = setup();
    await waitFor(() => expect(view.getByTestId('day-order-optimize')).toBeTruthy());
    fireEvent.press(view.getByTestId('day-order-optimize'));
    fireEvent.press(view.getByTestId('day-order-cancel'));
    expect(view.queryByTestId('day-order-preview')).toBeNull();
    expect(view.puts()).toHaveLength(0);
  });

  it('says so, instead of offering a pointless preview, when the order is already short', async () => {
    const view = setup({ activities: [{ ...B, dayPosition: 0 }, { ...D, dayPosition: 1 }, { ...C, dayPosition: 2 }] });
    await waitFor(() => expect(view.getByTestId('day-order-optimize')).toBeTruthy());
    fireEvent.press(view.getByTestId('day-order-optimize'));
    expect(view.queryByTestId('day-order-preview')).toBeNull();
    expect(view.getByTestId('day-order-notice').props.children).toBe('This order is already about as short as it gets.');
  });

  it('keeps booked activities with a set time in place and says why', async () => {
    const booked: OrderableActivity = { ...D, id: 'booked', name: 'Booked Tour', status: 'Booked', startTime: '10:00', dayPosition: 1 };
    const view = setup({ activities: [{ ...A, dayPosition: 0 }, booked, { ...B, dayPosition: 2 }, { ...C, dayPosition: 3 }] });
    await waitFor(() => expect(view.getByTestId('day-order-optimize')).toBeTruthy());
    fireEvent.press(view.getByTestId('day-order-optimize'));
    expect(view.getByText(/stay where they are/)).toBeTruthy();
    fireEvent.press(view.getByTestId('day-order-apply'));
    await waitFor(() => expect(view.puts()).toHaveLength(1));
    expect(view.body().orderedIds[1]).toBe('booked');
  });

  it('disables Optimize and explains why when fewer than two stops have a map location', async () => {
    const view = setup({ activities: [A, { ...B, lat: null, lng: null }] });
    await waitFor(() => expect(view.getByTestId('day-order-optimize')).toBeTruthy());
    expect(view.getByTestId('day-order-optimize').props.disabled).toBe(true);
    expect(view.getByText('Optimizing needs at least two activities with a map location.')).toBeTruthy();
  });

  it('offers the lodging as start and end, on by default, and the user can turn it off', async () => {
    const lodging = { lat: 35.68, lng: 139.95 };
    const view = setup({ lodging });
    await waitFor(() => expect(view.getByTestId('day-order-lodging-toggle')).toBeTruthy());
    expect(view.getByTestId('day-order-lodging-toggle').props.accessibilityState.checked).toBe(true);
    fireEvent.press(view.getByTestId('day-order-lodging-toggle'));
    expect(view.getByTestId('day-order-lodging-toggle').props.accessibilityState.checked).toBe(false);
  });

  it('on a conflict, drops the preview, refetches, and tells the user someone else changed the day', async () => {
    const view = setup({
      onPut: () => ({ status: 409, body: { error: 'This day was changed by someone else. Review the new order and try again.', code: 'DAY_ORDER_STALE', currentOrder: ['b', 'a'] } }),
    });
    await waitFor(() => expect(view.getByTestId('day-order-optimize')).toBeTruthy());
    fireEvent.press(view.getByTestId('day-order-optimize'));
    fireEvent.press(view.getByTestId('day-order-apply'));
    await waitFor(() => expect(view.onChanged).toHaveBeenCalled());
    expect(view.getByTestId('day-order-notice').props.children).toMatch(/changed by someone else/);
    expect(view.queryByTestId('day-order-preview')).toBeNull();
    expect(view.queryByTestId('day-order-undo')).toBeNull();
  });

  it('keeps the current order and says nothing was changed when the connection is lost', async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('planning-capabilities')) return json({ body: { dayOrder: true } });
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const onChanged = jest.fn();
    const view = render(
      <DayActivitiesOrdering tripId="trip-1" date="2027-05-02" backendUrl="https://api.example.com" headers={{}}
        activities={[A, B]} onChanged={onChanged} styles={styles}
        renderRow={(activity, controls) => (<View key={activity.id}><Text>{activity.name}</Text>{controls}</View>)} />,
    );
    await waitFor(() => expect(view.getByTestId('day-order-down-a')).toBeTruthy());
    fireEvent.press(view.getByTestId('day-order-down-a'));
    await waitFor(() => expect(view.getByTestId('day-order-notice').props.children).toMatch(/Nothing was changed/));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('ignores a second press while a save is in flight, so one tap cannot send two reorders', async () => {
    let release: (reply: Reply) => void = () => undefined;
    const gate = new Promise<Reply>((resolve) => { release = resolve; });
    const view = setup({ onPut: () => gate });
    await waitFor(() => expect(view.getByTestId('day-order-down-a')).toBeTruthy());
    fireEvent.press(view.getByTestId('day-order-down-a'));
    fireEvent.press(view.getByTestId('day-order-down-b'));
    await waitFor(() => expect(view.puts()).toHaveLength(1));
    release({ body: { order: [] } });
    await waitFor(() => expect(view.onChanged).toHaveBeenCalledTimes(1));
    expect(view.puts()).toHaveLength(1);
  });
});
