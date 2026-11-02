/** @jest-environment node */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import BlogDayPlaceRatings from '../components/BlogDayPlaceRatings';
import { ThemeProvider } from '../theme/ThemeContext';
import { getAppTheme } from '../theme/theme';

const theme = getAppTheme('light', 'light');
const activities = [{ id: 'a1', name: 'Belem Tower', date: '2027-05-02', userStars: null }, { id: 'a2', name: 'Time Out Market', date: '2027-05-02', userStars: 4 }];

const mount = (props: Partial<React.ComponentProps<typeof BlogDayPlaceRatings>> = {}) =>
  render(
    <ThemeProvider theme={theme}>
      <BlogDayPlaceRatings backendUrl="http://api" headers={{ Authorization: 'Bearer t' }} tripId="trip-1" activities={activities} theme={theme} {...props} />
    </ThemeProvider>
  );

describe('BlogDayPlaceRatings (R10)', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn(async (url: string) => ({ ok: true, json: async () => (String(url).endsWith('/places/rating') ? { rated: 1, matched: 1 } : { id: 'item-1' }) }));
    (global as any).fetch = fetchMock;
  });
  afterEach(() => { delete (global as any).fetch; });

  it('rates a planned activity with one tap on a star, saving the same stars the itinerary uses', async () => {
    const view = mount();
    fireEvent.press(view.getByTestId('blog-day-rate-a1-star-5'));
    await waitFor(() => expect(view.getByText('Your rating is saved.')).toBeTruthy());
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/places/rating'));
    expect(call?.[0]).toBe('http://api/api/trips/trip-1/blog/places/rating');
    expect(JSON.parse(call?.[1].body)).toEqual({ place: 'Belem Tower', stars: 5 });
  });

  it('shows a rating the traveler already gave in the itinerary', () => {
    const view = mount();
    expect(view.getByTestId('blog-day-rate-a2-fill-4')).toBeTruthy();
    expect(view.queryByTestId('blog-day-rate-a2-fill-5')).toBeNull();
  });

  it('files a one-line opinion on the activity\'s day, and tells the blog to reload', async () => {
    const onNoteAdded = jest.fn();
    const view = mount({ onNoteAdded });
    fireEvent.press(view.getByTestId('blog-day-rate-note-open-a1'));
    fireEvent.changeText(view.getByTestId('blog-day-rate-note-a1'), 'Worth the queue');
    fireEvent.press(view.getByTestId('blog-day-rate-note-save-a1'));
    await waitFor(() => expect(onNoteAdded).toHaveBeenCalledTimes(1));
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/blog/items'));
    const body = JSON.parse(call?.[1].body);
    expect(body).toMatchObject({ kindKey: 'core.text', dayDate: '2027-05-02', tags: ['Place rating'] });
    expect(body.body).toContain('Belem Tower');
    expect(body.body).toContain('Worth the queue');
  });

  it('asks for something to save instead of sending an empty opinion', () => {
    const view = mount();
    fireEvent.press(view.getByTestId('blog-day-rate-note-open-a1'));
    fireEvent.press(view.getByTestId('blog-day-rate-note-save-a1'));
    expect(view.getByText('Choose a star rating or write a note first.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a failed save instead of pretending it worked', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({ error: 'Rating is closed' }) }));
    const view = mount();
    fireEvent.press(view.getByTestId('blog-day-rate-a1-star-3'));
    await waitFor(() => expect(view.getByText('Rating is closed')).toBeTruthy());
  });

  it('renders nothing for a day with no planned activities', () => {
    expect(mount({ activities: [] }).queryByTestId('blog-day-place-ratings')).toBeNull();
  });
});
