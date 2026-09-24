/// <reference types="jest" />
/// <reference types="node" />

import { fixedTableColumn } from '../utils/tableColumns';

describe('fixedTableColumn', () => {
  it('prevents a header or a body cell from growing or shrinking independently', () => {
    expect(fixedTableColumn(140)).toEqual({
      width: 140,
      minWidth: 140,
      maxWidth: 140,
      flexGrow: 0,
      flexShrink: 0,
    });
  });
});
