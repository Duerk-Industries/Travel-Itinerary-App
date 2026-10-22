import React from 'react';
import Papa from 'papaparse';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import PendingExpenseRecovery from '../components/PendingExpenseRecovery';
import { exportCsv } from '../utils/csvExport';

jest.mock('../utils/csvExport', () => ({ exportCsv: jest.fn(async () => 'downloaded') }));
it('exports unreadable contents with account scope in a non-formula CSV cell without deleting the original', async () => {
  const raw = '=HYPERLINK("https://example.test","broken")\n{"operationKey":"keep-this-key"}';
  const getRecoveryData = jest.fn(async () => raw);
  const screen = render(<PendingExpenseRecovery error="Unreadable queue" ownerId="owner-a" environment="https://api.test" getRecoveryData={getRecoveryData} />);
  fireEvent.press(screen.getByText('Export saved expense recovery data'));
  await waitFor(() => expect(exportCsv).toHaveBeenCalled());
  const csv = jest.mocked(exportCsv).mock.calls[0][0];
  const cell = Papa.parse<string[]>(csv).data[1][0];
  expect(cell.startsWith('{')).toBe(true);
  expect(JSON.parse(cell)).toMatchObject({ ownerId: 'owner-a', environment: 'https://api.test', raw });
  expect(screen.getByText('Recovery copy exported. The original is still kept on this device.')).toBeTruthy();
});
