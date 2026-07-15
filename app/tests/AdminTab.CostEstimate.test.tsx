/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AdminTab from '../tabs/AdminTab';

const costEstimateResponse = {
  assumptions: {
    totalUsers: 10000,
    premiumConversionPercent: 3,
    freeGenerationsPerMonth: 2,
    premiumGenerationsPerMonth: 6,
    costPerGenerationUsd: 0.0021,
    premiumMonthlyPriceUsdOverride: null,
    stripeFeePercent: 2.9,
    stripeFeeFixedUsd: 0.3,
    providerCallsPerUserPerMonth: {},
  },
  requestPricing: { SERPAPI: 0, WIKIMEDIA: 0 },
  hostingLineItems: [{ id: 'cloud-run', name: 'Cloud Run', monthlyCostUsd: 50 }],
  projected: {
    llmCostUsd: 44.52,
    requestApiCostUsd: 0,
    hostingCostUsd: 50,
    totalCostUsd: 94.52,
    premiumMonthlyPriceUsd: 5,
    netRevenuePerPremiumUserUsd: 4.56,
    breakEvenPremiumUsers: 21,
    byProvider: [],
  },
  actual: { months: [{ windowKey: '2026-07', byProvider: [{ provider: 'OPENAI', spendUsd: 44.52 }], totalUsd: 44.52 }] },
};

describe('AdminTab — Cost Estimator section', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('loads and renders the projected cost breakdown', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => costEstimateResponse,
    });
    global.fetch = fetchMock as any;

    const { getByText, getByDisplayValue } = render(
      <AdminTab backendUrl="http://example.test" headers={{ Authorization: 'Bearer token' }} initialSection="cost-estimate" />
    );

    await waitFor(() => expect(getByText('Total: $94.52/mo')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('http://example.test/api/admin/cost-estimate', expect.objectContaining({ headers: { Authorization: 'Bearer token' } }));
    expect(getByText('Break-even: 21 premium users')).toBeTruthy();
    // The hosting line item's name renders inside an editable TextInput, not a Text node.
    expect(getByDisplayValue('Cloud Run')).toBeTruthy();
  });

  it('requires a reason before saving an assumptions edit', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => costEstimateResponse });
    global.fetch = fetchMock as any;

    const { getByText, getAllByPlaceholderText } = render(
      <AdminTab backendUrl="http://example.test" headers={{ Authorization: 'Bearer token' }} initialSection="cost-estimate" />
    );
    await waitFor(() => expect(getByText('Save assumptions')).toBeTruthy());

    fireEvent.press(getByText('Save assumptions'));

    await waitFor(() => expect(getByText('A reason with at least 3 characters is required.')).toBeTruthy());
    // No PATCH call was made — only the initial GET.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Three cards (assumptions/hosting/pricing) share this placeholder; the assumptions card's
    // reason field renders first.
    const [assumptionsReasonInput] = getAllByPlaceholderText('Reason for change (required)');
    fireEvent.changeText(assumptionsReasonInput, 'Updated user growth forecast');
    fireEvent.press(getByText('Save assumptions'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://example.test/api/admin/cost-estimate/assumptions',
        expect.objectContaining({ method: 'PATCH' })
      )
    );
  });
});
