import { Platform } from 'react-native';
import { shadowStyle } from '../utils/shadowStyle';

describe('platform shadow styles', () => {
  const original = Platform.OS;
  afterEach(() => { Object.defineProperty(Platform, 'OS', { configurable: true, value: original }); });

  it('uses boxShadow with the original color and opacity on web', () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
    expect(shadowStyle('#123', 0.18, 0, 4, 10)).toEqual({ boxShadow: '0px 4px 10px rgba(17,34,51,0.18)' });
  });

  it('retains native shadow properties on iOS', () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    expect(shadowStyle('#000', 0.18, 0, 4, 10)).toEqual({ shadowColor: '#000', shadowOpacity: 0.18, shadowOffset: { width: 0, height: 4 }, shadowRadius: 10 });
  });
});
