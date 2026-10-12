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

  // Regression: a traveler's own name was appearing as a bare, checkable packing item -- instead
  // of only as their matrix column header -- whenever their personal contribution's item had no
  // category of its own and so fell back to being categorized under their own name (e.g. a
  // traveler who adds something to their personal packing list without picking a category). The
  // self-titled-heading filter below previously existed only client-side and only for presets
  // (stripping, e.g., a "General" item inside the General preset); it never covered personal
  // contributions, so this slipped through.
  it('strips a personal contribution\'s self-titled item (a traveler\'s own name) just like a preset\'s', () => {
    const inputGroups: any[] = [
      { key: 'preset:general', label: 'General', kind: 'preset', order: 0, items: [
        { id: 'i-shoes', category: 'Clothing', label: 'Comfortable walking shoes', position: 0 },
        { id: 'i-general-heading', category: '', label: 'General', position: 1 },
      ] },
      { key: 'contribution:bryan', label: 'Bryan', kind: 'personal', ownerMemberId: 'bryan', items: [
        { id: 'i-bryan', category: '', label: 'Bryan', position: 0 },
      ] },
      { key: 'contribution:linda', label: 'Linda', kind: 'personal', ownerMemberId: 'linda', items: [
        { id: 'i-linda', category: '', label: 'Linda', position: 0 },
      ] },
    ];

    const result = buildPackingListDisplayGroups(inputGroups, null);

    const labels = result.flatMap((group) => group.items.map((item) => item.label));
    expect(labels).toEqual(['Comfortable walking shoes']);
    expect(result.some((group) => group.label === 'Bryan' || group.label === 'Linda')).toBe(false);
  });

  it('still shows a personal item under the traveler\'s name when its label genuinely differs from that name', () => {
    const inputGroups: any[] = [
      { key: 'contribution:bryan', label: 'Bryan', kind: 'personal', ownerMemberId: 'bryan', items: [
        { id: 'i-sunglasses', category: '', label: 'Sunglasses', position: 0 },
      ] },
    ];

    const result = buildPackingListDisplayGroups(inputGroups, null);

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Bryan');
    expect(result[0].items.map((item) => item.label)).toEqual(['Sunglasses']);
  });
});
