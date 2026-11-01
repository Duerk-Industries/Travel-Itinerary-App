/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import BlogDiscoveryPanel from '../components/BlogDiscoveryPanel';

describe('BlogDiscoveryPanel', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

  it('loads plain search snippets and a derived places index lazily', async () => {
    global.fetch = jest.fn(async (url: any) => {
      if (String(url).includes('/search')) return { ok: true, json: async () => ({ results: [{ id: 'i1', localDate: '2027-04-02', snippet: 'Rainy market morning' }], nextCursor: null }) } as any;
      return { ok: true, json: async () => ({ places: [{ name: 'Pike Place Market', firstDate: '2027-04-02', occurrences: 2 }] }) } as any;
    }) as any;
    const view = render(<BlogDiscoveryPanel backendUrl="https://api.test" headers={{ Authorization: 'Bearer t' }} tripId="trip-1" searchEnabled placesEnabled />);
    fireEvent.changeText(view.getByTestId('blog-search-input'), 'market');
    fireEvent.press(view.getByTestId('blog-search-submit'));
    await waitFor(() => expect(view.getByText('Rainy market morning')).toBeTruthy());
    fireEvent.press(view.getByTestId('blog-load-places'));
    await waitFor(() => expect(view.getByText('Pike Place Market')).toBeTruthy());
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  describe('Rate this place', () => {
    const PLACES = { places: [{ name: 'Pike Place Market', firstDate: '2027-04-02', occurrences: 1 }, { name: 'Undated Spot', firstDate: null, occurrences: 1 }] };
    const setup = (rating: any = { matched: 1, rated: 1, notCompleted: 0, firstDate: '2027-04-02' }, itemOk = true) => {
      const calls: any[] = [];
      global.fetch = jest.fn(async (url: any, init?: any) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith('/blog/places')) return { ok: true, json: async () => PLACES } as any;
        if (String(url).endsWith('/blog/places/rating')) return { ok: true, json: async () => rating } as any;
        if (String(url).endsWith('/blog/items')) return itemOk ? ({ ok: true, json: async () => ({ id: 'n1' }) } as any) : ({ ok: false, json: async () => ({ error: 'Blog is at capacity' }) } as any);
        return { ok: false, json: async () => ({}) } as any;
      }) as any;
      const onRated = jest.fn();
      const view = render(<BlogDiscoveryPanel backendUrl="https://api.test" headers={{ Authorization: 'Bearer t' }} tripId="trip-1" placesEnabled onRated={onRated} />);
      return { view, calls, onRated };
    };
    const open = async (view: any, index = 0) => {
      fireEvent.press(view.getByTestId('blog-load-places'));
      await waitFor(() => expect(view.getByText('Pike Place Market')).toBeTruthy());
      fireEvent.press(view.getByTestId(`blog-rate-place-${index}`));
    };

    it("saves stars and a note together: the stars as a rating, the note as an entry on the place's first day", async () => {
      const { view, calls, onRated } = setup();
      await open(view);
      fireEvent.press(view.getByTestId('blog-rate-star-4'));
      fireEvent.changeText(view.getByTestId('blog-rate-note'), 'Best <chowder> ever & cheap');
      fireEvent.press(view.getByTestId('blog-rate-save'));
      await waitFor(() => expect(onRated).toHaveBeenCalled());
      const rating = calls.find((c) => c.url.endsWith('/blog/places/rating'));
      expect(JSON.parse(rating.init.body)).toEqual({ place: 'Pike Place Market', stars: 4 });
      const entry = JSON.parse(calls.find((c) => c.url.endsWith('/blog/items')).init.body);
      expect(entry).toMatchObject({ kindKey: 'core.text', dayDate: '2027-04-02', tags: ['Place rating'] });
      expect(entry.body).toBe('<p><strong>★★★★☆ Pike Place Market</strong></p><p>Best &lt;chowder&gt; ever &amp; cheap</p>');
      expect(view.getByText(/Your rating is saved\. Your note is on 2027-04-02\./)).toBeTruthy();
      expect(view.queryByTestId('blog-rate-form')).toBeNull();
    });

    it('a rating alone makes no blog entry, and says when it will count', async () => {
      const { view, calls } = setup({ matched: 1, rated: 0, notCompleted: 1, firstDate: '2027-04-02' });
      await open(view);
      fireEvent.press(view.getByTestId('blog-rate-star-2'));
      fireEvent.press(view.getByTestId('blog-rate-save'));
      await waitFor(() => expect(view.getByText(/once the activity is marked Completed/)).toBeTruthy());
      expect(calls.some((c) => c.url.endsWith('/blog/items'))).toBe(false);
    });

    it('needs a rating or a note, and a date before it can file a note', async () => {
      const { view, calls } = setup();
      await open(view);
      fireEvent.press(view.getByTestId('blog-rate-save'));
      expect(view.getByText('Choose a star rating or write a note first.')).toBeTruthy();
      fireEvent.press(view.getByTestId('blog-rate-cancel'));
      fireEvent.press(view.getByTestId('blog-rate-place-1'));
      fireEvent.changeText(view.getByTestId('blog-rate-note'), 'Lovely');
      fireEvent.press(view.getByTestId('blog-rate-save'));
      expect(view.getByText(/no date yet/)).toBeTruthy();
      expect(calls.filter((c) => !c.url.endsWith('/blog/places')).length).toBe(0);
    });

    it('keeps the form open and reports what was saved when the note cannot be filed', async () => {
      const { view, onRated } = setup(undefined, false);
      await open(view);
      fireEvent.press(view.getByTestId('blog-rate-star-5'));
      fireEvent.changeText(view.getByTestId('blog-rate-note'), 'Great');
      fireEvent.press(view.getByTestId('blog-rate-save'));
      await waitFor(() => expect(view.getByText(/Your rating is saved\. Blog is at capacity/)).toBeTruthy());
      expect(onRated).not.toHaveBeenCalled();
      expect(view.getByTestId('blog-rate-form')).toBeTruthy();
    });
  });

  it('renders nothing when both independently releasable flags are off', () => {
    expect(render(<BlogDiscoveryPanel backendUrl="" headers={{}} tripId="trip-1" />).toJSON()).toBeNull();
  });
});
