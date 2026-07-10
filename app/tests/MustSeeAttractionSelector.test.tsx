/// <reference types="jest" />
/// <reference types="node" />
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { MustSeeAttractionSelector, type AttractionOption } from '../components/MustSeeAttractionSelector';
import type { LocationOption } from '../components/LocationSelector';

const mockStyles = {
  row: {},
  input: {},
  button: {},
  smallButton: {},
  buttonText: {},
  card: {},
  bodyText: {},
  helperText: {},
  payerChip: {},
  cellText: {},
  removeText: {},
};

describe('MustSeeAttractionSelector', () => {
  const defaultProps = {
    backendUrl: 'http://test.com',
    headers: {},
    selectedLocations: [] as LocationOption[],
    selectedAttractions: [] as AttractionOption[],
    onAddAttraction: jest.fn(),
    onRemoveAttraction: jest.fn(),
    styles: mockStyles,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('shows destination selection helper when no locations are selected', () => {
    const { getByText } = render(<MustSeeAttractionSelector {...defaultProps} />);
    expect(getByText('Select at least one destination, country, or state to load attractions.')).toBeTruthy();
  });

  it('fetches attraction suggestions using selected location context', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 'attr:paris:eiffel-tower',
          sourceType: 'attraction',
          name: 'Eiffel Tower',
          destinationName: 'Paris',
        },
      ],
    });

    const selectedLocations: LocationOption[] = [
      { id: 'destination:paris-france', sourceType: 'destination', name: 'Paris', countryName: 'France' },
    ];
    const { getByPlaceholderText, getByText } = render(
      <MustSeeAttractionSelector {...defaultProps} selectedLocations={selectedLocations} />
    );
    fireEvent.changeText(getByPlaceholderText('Must See Attractions'), 'Eif');

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/places/location-options?kind=attraction&q=Eif'),
        expect.anything()
      );
      expect(getByText('Eiffel Tower')).toBeTruthy();
    });
  });

  it('adds manual attraction when no suggestions exist and auto-tags its destination when unambiguous', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    const selectedLocations: LocationOption[] = [
      { id: 'destination:paris-france', sourceType: 'destination', name: 'Paris', countryName: 'France' },
    ];
    const { getByPlaceholderText, findByText } = render(
      <MustSeeAttractionSelector {...defaultProps} selectedLocations={selectedLocations} />
    );
    fireEvent.changeText(getByPlaceholderText('Must See Attractions'), 'Secret Garden Walk');
    const manualOption = await findByText('Add "Secret Garden Walk"');
    fireEvent.press(manualOption);

    expect(defaultProps.onAddAttraction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Secret Garden Walk',
        sourceType: 'attraction',
        id: expect.stringMatching(/^manual-attraction-/),
        destinationName: 'Paris',
      })
    );
  });

  it('does not tag a destination for manual attractions when multiple destinations are selected', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    const selectedLocations: LocationOption[] = [
      { id: 'destination:boston-usa', sourceType: 'destination', name: 'Boston', countryName: 'USA' },
      { id: 'destination:new-york-usa', sourceType: 'destination', name: 'New York City', countryName: 'USA' },
    ];
    const { getByPlaceholderText, findByText } = render(
      <MustSeeAttractionSelector {...defaultProps} selectedLocations={selectedLocations} />
    );
    fireEvent.changeText(getByPlaceholderText('Must See Attractions'), 'Central Park');
    const manualOption = await findByText('Add "Central Park"');
    fireEvent.press(manualOption);

    const addedAttraction = defaultProps.onAddAttraction.mock.calls[0][0];
    expect(addedAttraction.name).toBe('Central Park');
    expect(addedAttraction.destinationName).toBeUndefined();
  });
});
