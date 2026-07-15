import { buildPackingListDisplayGroups } from '../src/utils/packingListDisplay';

describe('packing-list display groups', () => {
  it('orders, deduplicates, groups shared personal items, and omits empty groups', () => {
    const groups = buildPackingListDisplayGroups([
      { key: 'men', label: 'Men', kind: 'preset', order: 1, items: [{ id: 'm', category: 'Clothing', label: 'Socks', position: 0 }] },
      { key: 'general', label: 'General', kind: 'preset', order: 0, items: [{ id: 'g', category: 'Basics', label: 'Socks', position: 0 }, { id: 'g2', category: 'Basics', label: 'Passport', position: 1 }] },
      { key: 'personal:a', label: 'A personal list', kind: 'personal', ownerMemberId: 'a', order: 0, items: [{ id: 'a', category: 'Personal', label: 'Passport', position: 0, personalOwnerIds: ['a', 'b'] }] },
      { key: 'personal:b', label: 'B personal list', kind: 'personal', ownerMemberId: 'b', order: 1, items: [{ id: 'b', category: 'Personal', label: 'Passport', position: 0, personalOwnerIds: ['a', 'b'] }] },
    ], 'b');
    expect(groups.map((group) => group.key)).toEqual(['general']);
    expect(groups[0].items.map((item) => item.label)).toEqual(['Socks', 'Passport']);
  });
});
