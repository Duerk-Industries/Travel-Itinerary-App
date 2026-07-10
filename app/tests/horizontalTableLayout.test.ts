/// <reference types="jest" />
/// <reference types="node" />
import { horizontalTableLayout } from '../utils/horizontalTableLayout';

describe('horizontal table layout', () => {
  it('allows table rows to grow wider than the viewport', () => {
    expect(horizontalTableLayout.table).toEqual({
      minWidth: '100%',
      alignSelf: 'flex-start',
    });
    expect(horizontalTableLayout.table).not.toHaveProperty('width');
  });

  it('bounds the scroll viewport while keeping its content at least viewport width', () => {
    expect(horizontalTableLayout.scroll).toEqual({
      width: '100%',
      maxWidth: '100%',
    });
    expect(horizontalTableLayout.content).toEqual({
      minWidth: '100%',
    });
    expect(horizontalTableLayout.scroll).not.toHaveProperty('overflow');
    expect(horizontalTableLayout.content).not.toHaveProperty('overflow');
  });
});
