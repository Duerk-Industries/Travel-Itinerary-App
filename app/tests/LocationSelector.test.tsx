/// <reference types="jest" />
/// <reference types="node" />
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { LocationSelector, type LocationOption } from '../components/LocationSelector';
import { Platform } from 'react-native';

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

describe('LocationSelector', () => {
  const defaultProps = {
    backendUrl: 'http://test.com',
    headers: {},
    selectedLocations: [],
    onAddLocation: jest.fn(),
    onRemoveLocation: jest.fn(),
    onNext: jest.fn(),
    styles: mockStyles,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('renders inputs correctly', () => {
    const { getByPlaceholderText, getAllByText } = render(<LocationSelector {...defaultProps} />);
    expect(getByPlaceholderText('Search countries or states')).toBeTruthy();
    expect(getByPlaceholderText('Search cities')).toBeTruthy();
    expect(getAllByText('Add').length).toBe(2);
  });

  it('supports destination mode without city search', () => {
    const { getByPlaceholderText, queryByPlaceholderText, getAllByText } = render(
      <LocationSelector
        {...defaultProps}
        placeholder="Search destinations, countries, or states"
        locationSearchKind="country_destination"
        showCitySearch={false}
      />
    );
    expect(getByPlaceholderText('Search destinations, countries, or states')).toBeTruthy();
    expect(queryByPlaceholderText('Search cities')).toBeNull();
    expect(getAllByText('Add').length).toBe(1);
  });

  it('fetches country/state suggestions on input', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'state-1', name: 'California', sourceType: 'state' }],
    });

    const { getByPlaceholderText, getByText } = render(<LocationSelector {...defaultProps} />);
    const input = getByPlaceholderText('Search countries or states');

    fireEvent.changeText(input, 'Cal');

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/places/location-options?kind=country_state&q=Cal'),
        expect.anything()
      );
      expect(getByText('California')).toBeTruthy();
    });
  });

  it('uses requested location kind when fetching options', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'destination:paris-france', name: 'Paris', sourceType: 'destination' }],
    });

    const { getByPlaceholderText, getByText } = render(
      <LocationSelector
        {...defaultProps}
        placeholder="Search destinations, countries, or states"
        locationSearchKind="country_destination"
        showCitySearch={false}
      />
    );
    const input = getByPlaceholderText('Search destinations, countries, or states');
    fireEvent.changeText(input, 'Par');

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/places/location-options?kind=country_destination&q=Par'),
        expect.anything()
      );
      expect(getByText('Paris')).toBeTruthy();
    });
  });

  it('adds state and auto-selects country on suggestion click', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 'state-1',
          name: 'California',
          sourceType: 'state',
          countryId: 'country-1',
          countryName: 'United States',
        },
      ],
    });

    const { getByPlaceholderText, getByText } = render(<LocationSelector {...defaultProps} />);
    const input = getByPlaceholderText('Search countries or states');

    fireEvent.changeText(input, 'Cal');

    await waitFor(() => getByText('California'));
    fireEvent.press(getByText('California'));

    expect(defaultProps.onAddLocation).toHaveBeenCalledWith({
      id: 'country-1',
      name: 'United States',
      sourceType: 'country',
    });
    expect(defaultProps.onAddLocation).toHaveBeenCalledWith({
      id: 'state-1',
      name: 'California',
      sourceType: 'state',
      countryId: 'country-1',
      countryName: 'United States',
    });
  });

  it('adds only the city when a city suggestion is selected', async () => {
    const selectedLocations: LocationOption[] = [
      { id: 'state-1', name: 'California', sourceType: 'state', countryId: 'country-1', countryName: 'United States' },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 'city-1',
          name: 'San Francisco',
          sourceType: 'city',
          countryId: 'country-1',
          countryName: 'United States',
          stateId: 'state-1',
          stateName: 'California',
        },
      ],
    });

    const { getByPlaceholderText, getByText } = render(
      <LocationSelector {...defaultProps} selectedLocations={selectedLocations} />
    );
    const cityInput = getByPlaceholderText('Search cities');

    fireEvent.changeText(cityInput, 'San');

    await waitFor(() => getByText('San Francisco'));
    fireEvent.press(getByText('San Francisco'));

    expect(defaultProps.onAddLocation).toHaveBeenCalledWith({
      id: 'city-1',
      name: 'San Francisco',
      sourceType: 'city',
      countryId: 'country-1',
      countryName: 'United States',
      stateId: 'state-1',
      stateName: 'California',
    });
  });

  it('shows helper text when city search is disabled', () => {
    const { getByText } = render(<LocationSelector {...defaultProps} />);
    expect(getByText('Select at least one country or state to add cities.')).toBeTruthy();
  });

  it('adds manual country when no suggestions found', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    const { getByPlaceholderText, findByText } = render(<LocationSelector {...defaultProps} />);
    const input = getByPlaceholderText('Search countries or states');

    fireEvent.changeText(input, 'Narnia');

    const manualOption = await findByText('Add "Narnia"');
    fireEvent.press(manualOption);

    expect(defaultProps.onAddLocation).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Narnia',
      sourceType: 'country',
      id: expect.stringMatching(/^manual-country-/),
    }));
  });

  it('adds manual city when no suggestions found', async () => {
    const selectedLocations: LocationOption[] = [
      { id: 'country-1', name: 'United States', sourceType: 'country' },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    const { getByPlaceholderText, findByText } = render(
      <LocationSelector {...defaultProps} selectedLocations={selectedLocations} />
    );
    const input = getByPlaceholderText('Search cities');

    fireEvent.changeText(input, 'Atlantis');

    const manualOption = await findByText('Add "Atlantis"');
    fireEvent.press(manualOption);

    expect(defaultProps.onAddLocation).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Atlantis',
      sourceType: 'city',
      id: expect.stringMatching(/^manual-city-/),
    }));
  });

  it('adds manual city even when name matches selected state/country', async () => {
    const selectedLocations: LocationOption[] = [
      { id: 'country-1', name: 'United States', sourceType: 'country' },
      { id: 'state-1', name: 'California', sourceType: 'state', countryId: 'country-1', countryName: 'United States' },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    const { getByPlaceholderText, findByText } = render(
      <LocationSelector {...defaultProps} selectedLocations={selectedLocations} />
    );
    const input = getByPlaceholderText('Search cities');

    fireEvent.changeText(input, 'California');

    const manualOption = await findByText('Add "California"');
    fireEvent.press(manualOption);

    expect(defaultProps.onAddLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'California',
        sourceType: 'city',
        id: expect.stringMatching(/^manual-city-/),
      })
    );
  });

  it('calls onNext when country/state input is empty', () => {
    const { getByPlaceholderText } = render(<LocationSelector {...defaultProps} />);
    const input = getByPlaceholderText('Search countries or states');

    fireEvent(input, 'submitEditing');

    expect(defaultProps.onNext).toHaveBeenCalled();
  });

  it('shows loading indicator while fetching country/state', async () => {
    jest.useFakeTimers();
    let pendingResolve: (value: any) => void = () => {};
    const pendingPromise = new Promise<any>((resolve) => {
      pendingResolve = resolve;
    });
    (global.fetch as jest.Mock).mockReturnValue(pendingPromise);
    const { getByPlaceholderText, getByTestId } = render(<LocationSelector {...defaultProps} />);
    const input = getByPlaceholderText('Search countries or states');

    fireEvent.changeText(input, 'Cal');

    await waitFor(() => expect(getByTestId('country-state-loading')).toBeTruthy());

    pendingResolve({
      ok: true,
      json: async () => [{ id: 'state-1', name: 'California', sourceType: 'state' }],
    });
    jest.useRealTimers();
  });

  it('selects first suggestion on Tab key for country/state', async () => {
    const originalOS = Platform.OS;
    (Platform as any).OS = 'web';
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'country-1', name: 'Canada', sourceType: 'country' }],
    });

    const { getByPlaceholderText, getByText } = render(<LocationSelector {...defaultProps} />);
    const input = getByPlaceholderText('Search countries or states');

    fireEvent.changeText(input, 'Can');
    await waitFor(() => getByText('Canada'));

    fireEvent(input, 'keyPress', { nativeEvent: { key: 'Tab' }, preventDefault: jest.fn() });

    expect(defaultProps.onAddLocation).toHaveBeenCalledWith({
      id: 'country-1',
      name: 'Canada',
      sourceType: 'country',
    });
    (Platform as any).OS = originalOS;
  });

  it('elevates the dropdown above sibling fields on native, not just web', async () => {
    // Regression test: the dropdown zIndex used to only elevate when Platform.OS === 'web',
    // so on iOS/Android the suggestion list stayed at its base zIndex and visually overlapped
    // with sibling fields rendered after it (e.g. MustSeeAttractionSelector) instead of
    // stacking above them.
    const originalOS = Platform.OS;
    (Platform as any).OS = 'ios';
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'country-1', name: 'Canada', sourceType: 'country' }],
    });

    const { getByPlaceholderText, getByText, getByTestId } = render(<LocationSelector {...defaultProps} />);
    expect(getByTestId('location-selector-root').props.style.zIndex).toBe(1);

    const input = getByPlaceholderText('Search countries or states');
    fireEvent.changeText(input, 'Can');
    await waitFor(() => getByText('Canada'));

    expect(getByTestId('location-selector-root').props.style.zIndex).toBe(800);
    (Platform as any).OS = originalOS;
  });
});
