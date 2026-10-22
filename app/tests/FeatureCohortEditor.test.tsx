import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import FeatureCohortEditor from '../components/FeatureCohortEditor';
import { getAppTheme } from '../theme/theme';

it('loads on demand and saves an owned, expiring cohort with an audit reason', async () => {
  const original = global.fetch;
  const fetcher = jest.fn(async () => ({ ok: true, json: async () => ({ cohort: null }) }) as Response);
  global.fetch = fetcher;
  try {
    const screen = render(<FeatureCohortEditor featureKey="planning_nearby" backendUrl="https://api.test" headers={{ Authorization: 'Bearer admin' }} theme={getAppTheme('light', 'light')} />);
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Manage rollout cohort'));
    await waitFor(() => expect(screen.getByLabelText('Cohort user IDs')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('Cohort user IDs'), '11111111-1111-4111-8111-111111111111');
    fireEvent.changeText(screen.getByLabelText('Cohort owner'), 'Planning');
    fireEvent.changeText(screen.getByLabelText('Cohort retirement date'), '2099-01-01');
    fireEvent.press(screen.getByText('Save restricted cohort'));
    expect(screen.getByText('Enter a reason of at least three characters.')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Cohort change reason'), 'Pilot rollout');
    fireEvent.press(screen.getByText('Save restricted cohort'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('https://api.test/api/admin/features/planning_nearby/cohort', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ cohort: { userIds: ['11111111-1111-4111-8111-111111111111'], owner: 'Planning', retireAfter: '2099-01-01T23:59:59.000Z' }, reason: 'Pilot rollout' }) })));
  } finally { global.fetch = original; }
});
