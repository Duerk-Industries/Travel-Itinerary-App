import { buildPackingListDisplayGroups } from '../src/utils/packingListDisplay';

describe('packing-list display groups', () => {
  it('orders and deduplicates groups with precedence: preset > manual > multiple > personal', () => {
    const inputGroups: any[] = [
      { key: 'personal:b', label: 'Bob personal', kind: 'personal', ownerMemberId: 'b', items: [{ id: 'b1', label: 'Kindle', category: 'Personal' }] },
      { key: 'personal:a', label: 'Alex personal', kind: 'personal', ownerMemberId: 'a', items: [{ id: 'a1', label: 'Kindle', category: 'Personal' }, { id: 'a2', label: 'Passport', category: 'Personal' }] },
      { key: 'trip_manual', label: 'Trip additions', kind: 'trip_manual', items: [{ id: 't1', label: 'Group Snacks', category: 'Food' }] },
      { key: 'beach', label: 'Beach', kind: 'preset', items: [{ id: 'p1', label: 'Towel', category: 'Beach' }] },
      { key: 'general', label: 'General', kind: 'preset', items: [{ id: 'g1', label: 'Passport', category: 'Basics' }] },
    ];

    const result = buildPackingListDisplayGroups(inputGroups, 'a');

    expect(result.map(g => g.key)).toEqual([
      'general',
      'beach',
      'trip_manual',
      'multiple_travelers',
    ]);

    // Alex personal is omitted because 'Passport' is in General and 'Kindle' is in Multiple Travelers.
    // Bob personal is omitted because 'Kindle' is in Multiple Travelers.
  });

  it('omits groups that become empty after deduplication', () => {
    const inputGroups: any[] = [
      { key: 'general', label: 'General', kind: 'preset', items: [{ id: 'g1', label: 'Passport', category: 'Basics' }] },
      { key: 'personal:a', label: 'Alex personal', kind: 'personal', ownerMemberId: 'a', items: [{ id: 'a1', label: 'Passport', category: 'Personal' }] },
    ];
    const result = buildPackingListDisplayGroups(inputGroups, 'a');
    expect(result.map(g => g.key)).toEqual(['general']);
  });
});
