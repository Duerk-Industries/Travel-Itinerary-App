import { describe, expect, test } from '@jest/globals';
import { buildMapUrl } from '../../app/utils/mapLinks';
import { formatLodgingDetails } from '../../app/utils/overviewBuilder';

describe('Overview map helper coverage', () => {
  test('buildMapUrl produces provider specific URLs', () => {
    const address = '1 Infinite Loop, Cupertino, CA';
    expect(buildMapUrl(address, 'google')).toContain('google.com/maps');
    expect(buildMapUrl(address, 'apple')).toContain('maps.apple.com');
    expect(buildMapUrl(address, 'waze')).toContain('waze.com/ul');
  });

  test('lodging details attach address link via preferred map', () => {
    const lodging = {
      id: 'lodging-map',
      name: 'Ocean View Retreat',
      checkInDate: '2026-02-10',
      checkOutDate: '2026-02-12',
      address: '410 Seaside Ave, Santa Monica, CA',
    };
    const details = formatLodgingDetails(lodging as any, 'waze');
    const addressDetail = details.find((item) => item.label === 'Address');
    expect(addressDetail?.linkUrl).toContain('waze.com/ul');
  });
});
