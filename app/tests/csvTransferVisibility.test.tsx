/** @jest-environment node */
import React from 'react';
import { Platform, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import CsvTransferControls from '../components/CsvTransferControls';
import type { TransferEntity } from '../utils/dataTransfer';

let mockPhoneLayout = false;
jest.mock('../hooks/useLayoutBreakpoints', () => ({
  useLayoutBreakpoints: () => ({ isPhoneLayout: mockPhoneLayout }),
}));
jest.mock('../utils/dataTransferPlatform', () => ({ pickCsvFile: jest.fn(), shareCsvFile: jest.fn() }));

const originalOS = Platform.OS;
afterEach(() => { Platform.OS = originalOS; mockPhoneLayout = false; });
const props = { backendUrl: 'http://api.test', headers: {}, tripId: 'trip', rows: [], styles: {}, enabledImport: true, enabledExport: true };

it.each<TransferEntity>(['activities', 'lodgings', 'transfers', 'car-rentals', 'day-plan'])('hides %s CSV tools on mobile web and native, preserving desktop web', (entity) => {
  Platform.OS = 'web';
  const screen = render(<CsvTransferControls {...props} entity={entity} />);
  expect(screen.getByTestId(`${entity}-import`)).toBeTruthy();
  expect(screen.getByTestId(`${entity}-export`)).toBeTruthy();
  mockPhoneLayout = true;
  screen.rerender(<CsvTransferControls {...props} entity={entity} />);
  expect(screen.queryByTestId(`${entity}-import`)).toBeNull();
  expect(screen.queryByTestId(`${entity}-export`)).toBeNull();
  mockPhoneLayout = false;
  for (const platform of ['ios', 'android'] as const) {
    Platform.OS = platform;
    screen.rerender(<CsvTransferControls {...props} entity={entity} />);
    expect(screen.queryByTestId(`${entity}-import`)).toBeNull();
    expect(screen.queryByTestId(`${entity}-export`)).toBeNull();
  }
});

it('keeps other overview menu actions available when CSV actions are hidden', () => {
  Platform.OS = 'web';
  mockPhoneLayout = true;
  const screen = render(<CsvTransferControls {...props} entity="day-plan" renderActions={({ canImportCsv, canExportCsv }) => <>
    <Text>Share</Text>
    {canImportCsv ? <Text>Import Table</Text> : null}
    {canExportCsv ? <Text>Export Table</Text> : null}
  </>} />);
  expect(screen.getByText('Share')).toBeTruthy();
  expect(screen.queryByText('Import Table')).toBeNull();
  expect(screen.queryByText('Export Table')).toBeNull();
});
