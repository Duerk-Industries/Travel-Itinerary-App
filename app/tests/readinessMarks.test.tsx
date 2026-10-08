/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
import React from 'react';
import { render, act } from '@testing-library/react-native';

const mockGetInitState = jest.fn();
jest.mock('../utils/sentry', () => ({ getInitState: () => mockGetInitState() }));

import {
  __resetReadinessForTests,
  markLoginStarted,
  markTripReady,
  recordReadiness,
  useScreenReadyMark,
} from '../utils/readinessMarks';

const end = jest.fn();
const startInactiveSpan = jest.fn((_options: any) => ({ end }));

const Page = ({ page }: { page: string }) => {
  useScreenReadyMark(page);
  return null;
};

describe('readinessMarks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetReadinessForTests(() => ({ startInactiveSpan }));
    mockGetInitState.mockReturnValue({ initialized: true, reason: 'configured' });
    (globalThis as any).requestAnimationFrame = (cb: () => void) => { cb(); return 1; };
  });

  it('records nothing without diagnostics consent (Sentry not initialized)', () => {
    mockGetInitState.mockReturnValue({ initialized: false, reason: 'missing-consent' });
    expect(recordReadiness('app.trip_ready', 0, 100)).toBe(false);
    markTripReady({ hasTrips: true });
    expect(startInactiveSpan).not.toHaveBeenCalled();
  });

  it('records cold-start trip readiness once, then login-to-trips for later sign-ins', () => {
    markTripReady({ hasTrips: true });
    markTripReady({ hasTrips: true }); // no pending login: nothing
    markLoginStarted();
    markTripReady({ hasTrips: false });
    expect(startInactiveSpan.mock.calls.map(([o]: any[]) => [o.name, o.op, o.attributes.trigger, o.attributes.hasTrips])).toEqual([
      ['app.trip_ready', 'ui.ready', 'cold_start', true],
      ['app.trip_ready', 'ui.ready', 'login', false],
    ]);
    expect(end).toHaveBeenCalledTimes(2);
  });

  it('uses bounded attributes only, with epoch-second timestamps', () => {
    recordReadiness('ui.screen_ready', 10, 60, { page: 'itinerary' });
    const [options] = startInactiveSpan.mock.calls[0] as any[];
    expect(Object.keys(options.attributes).sort()).toEqual(['page', 'platform']);
    expect(options.startTime).toBeGreaterThan(1_600_000_000); // seconds since epoch, not ms
    expect(end.mock.calls[0][0] - options.startTime).toBeCloseTo(0.05, 3);
  });

  it('rejects inverted or non-finite intervals', () => {
    expect(recordReadiness('x', 100, 50)).toBe(false);
    expect(recordReadiness('x', Number.NaN, 50)).toBe(false);
    expect(startInactiveSpan).not.toHaveBeenCalled();
  });

  it('measures a page change once and skips the initial page', () => {
    const view = render(<Page page="home" />);
    expect(startInactiveSpan).not.toHaveBeenCalled();
    act(() => { view.rerender(<Page page="itinerary" />); });
    act(() => { view.rerender(<Page page="itinerary" />); }); // same page: no new mark
    expect(startInactiveSpan).toHaveBeenCalledTimes(1);
    expect(startInactiveSpan.mock.calls[0][0]).toMatchObject({ name: 'ui.screen_ready', attributes: { page: 'itinerary' } });
  });
});
