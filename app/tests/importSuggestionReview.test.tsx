/** @jest-environment node */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ImportSuggestionReview from '../components/ImportSuggestionReview';
jest.mock('react-native', () => ({Text: 'Text', TouchableOpacity: 'TouchableOpacity', View: 'View', StyleSheet: {flatten: (s: unknown) => s}}));
const row = {itemId: 'a', itemType: 'flight', label: 'Delta', tripId: 'trip', tripName: 'Tokyo', reasons: ['Dates fit'], reviewVersion: 'version', forwarderTrust: 'uncertain', startDate: '2027-05-10', endDate: '2027-05-11', amount: 450, currency: 'USD'};
const response = (body: unknown, ok = true) => ({ok, json: async () => body});
const props = {backendUrl: 'https://test', headers: {Authorization: 'Bearer a'}, styles: {}, onConfirmed: jest.fn(), onReviewItem: jest.fn()};
beforeEach(() => { jest.clearAllMocks(); global.fetch = jest.fn(); });
it('requires explicit review and selection, then sends only the reviewed identifiers and version', async () => {
  (fetch as jest.Mock).mockResolvedValueOnce(response({suggestions: [row], needsIndividualReview: 0, remaining: 0}))
    .mockResolvedValueOnce(response({assigned: [{id: 'a',tripId: 'trip',itemType: 'flight'}], failed: []}));
  const ui = render(<ImportSuggestionReview {...props}/>);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.press(ui.getByText('Review matching bookings'));
  expect(await ui.findByText(/confirm who forwarded/)).toBeTruthy();
  expect(ui.getByLabelText('Confirm 0 selected suggestions').props.disabled).toBe(true);
  fireEvent.press(ui.getByLabelText('Select all matching suggestions'));
  fireEvent.press(ui.getByLabelText('Confirm 1 selected suggestions'));
  await waitFor(() => expect(props.onConfirmed).toHaveBeenCalledWith([{id: 'a',tripId: 'trip',itemType: 'flight'}]));
  expect(JSON.parse((fetch as jest.Mock).mock.calls[1][1].body)).toEqual({suggestions: [{itemId: 'a',tripId: 'trip',reviewVersion: 'version'}]});
  expect(ui.queryByText(/Delta → Tokyo/)).toBeNull();
});
it('retains failed rows after partial confirmation and offers individual review', async () => {
  (fetch as jest.Mock).mockResolvedValueOnce(response({suggestions: [row, {...row,itemId:'b',label:'Hotel'}], needsIndividualReview: 1, remaining: 0}))
    .mockResolvedValueOnce(response({assigned: [{id: 'a',tripId: 'trip',itemType: 'flight'}], failed: [{id:'b',reason:'This booking changed.'}]}));
  const ui = render(<ImportSuggestionReview {...props}/>); fireEvent.press(ui.getByText('Review matching bookings'));
  await ui.findByText(/Delta → Tokyo/); fireEvent.press(ui.getByLabelText('Select all matching suggestions'));
  fireEvent.press(ui.getByLabelText('Confirm 2 selected suggestions'));
  expect(await ui.findByText('This booking changed.')).toBeTruthy();
  expect(ui.queryByText(/Delta → Tokyo/)).toBeNull(); expect(ui.getByText(/Hotel → Tokyo/)).toBeTruthy();
  fireEvent.press(ui.getByText('Review this booking')); expect(props.onReviewItem).toHaveBeenCalledWith('b');
});
it('keeps the selection on an uncertain HTTP result so a safe retry is possible', async () => {
  (fetch as jest.Mock).mockResolvedValueOnce(response({suggestions:[row],needsIndividualReview:0,remaining:0}))
    .mockRejectedValueOnce(new Error('Connection lost'));
  const ui = render(<ImportSuggestionReview {...props}/>); fireEvent.press(ui.getByText('Review matching bookings'));
  await ui.findByText(/Delta → Tokyo/); fireEvent.press(ui.getByLabelText('Select all matching suggestions'));
  fireEvent.press(ui.getByLabelText('Confirm 1 selected suggestions'));
  expect(await ui.findByText('Connection lost')).toBeTruthy(); expect(ui.getByLabelText('Confirm 1 selected suggestions').props.disabled).toBe(false);
  expect(props.onConfirmed).not.toHaveBeenCalled();
});
it('can page past a full batch needing individual review', async () => {
  (fetch as jest.Mock).mockResolvedValueOnce(response({suggestions:[],needsIndividualReview:20,remaining:1,nextAfter:'last'}))
    .mockResolvedValueOnce(response({suggestions:[row],needsIndividualReview:0,remaining:0}));
  const ui = render(<ImportSuggestionReview {...props}/>); fireEvent.press(ui.getByText('Review matching bookings'));
  fireEvent.press(await ui.findByText('Review next batch (1 remaining)')); await ui.findByText(/Delta → Tokyo/);
  expect((fetch as jest.Mock).mock.calls[1][0]).toBe('https://test/api/ingestion/review-suggestions?after=last');
});
it('discards old-account previews without disabling a new account request', async () => {
  let finish!: (r: unknown) => void;
  (fetch as jest.Mock).mockReturnValueOnce(new Promise(resolve => {finish = resolve;}))
    .mockResolvedValueOnce(response({suggestions:[],needsIndividualReview:0,remaining:0}));
  const ui = render(<ImportSuggestionReview {...props}/>); fireEvent.press(ui.getByText('Review matching bookings'));
  ui.rerender(<ImportSuggestionReview {...props} headers={{Authorization:'Bearer b'}}/>);
  fireEvent.press(ui.getByText('Review matching bookings'));
  await ui.findByText(/No uniquely matched bookings/);
  await act(async () => {finish(response({suggestions:[row],needsIndividualReview:0,remaining:0}));});
  expect(ui.queryByText(/Delta → Tokyo/)).toBeNull();
});
