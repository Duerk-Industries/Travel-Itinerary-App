import { createPackingListScrollSync } from '../utils/packingListScrollSync';

describe('packing list scroll synchronization', () => {
  it('propagates meaningful offsets and suppresses feedback loops', () => {
    const calls: string[] = [];
    const sync = createPackingListScrollSync({
      horizontalHeader: (x) => calls.push(`header:${x}`),
      horizontalBody: (x) => calls.push(`body:${x}`),
      verticalLabels: (y) => calls.push(`labels:${y}`),
      verticalBody: (y) => calls.push(`rows:${y}`),
    });
    sync.syncX(20);
    sync.syncX(20.5);
    sync.syncY(36);
    sync.syncY(-4);
    expect(calls).toEqual(['header:20', 'body:20', 'labels:36', 'rows:36', 'labels:0', 'rows:0']);
    expect(sync.getOffsets()).toEqual({ x: 20, y: 0 });
  });
});
