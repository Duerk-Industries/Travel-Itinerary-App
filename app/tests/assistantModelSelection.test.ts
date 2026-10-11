/** @jest-environment jsdom */
/// <reference types="jest" />
import { detectAssistantModelCapability, isPhoneClassDevice } from '../utils/assistantLocalModel';

const setNavigator = (props: Record<string, unknown>) => {
  const original = Object.getOwnPropertyDescriptors(window.navigator);
  Object.entries(props).forEach(([key, value]) => Object.defineProperty(window.navigator, key, { value, configurable: true }));
  return () => Object.entries(props).forEach(([key]) => {
    if (original[key]) Object.defineProperty(window.navigator, key, original[key]);
    else delete (window.navigator as any)[key];
  });
};

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

describe('assistant is desktop-web only', () => {
  describe('isPhoneClassDevice', () => {
    it.each([
      ['iPhone Safari', IPHONE_UA, true],
      ['Android Chrome phone', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', true],
      ['Android tablet (no "Mobile")', 'Mozilla/5.0 (Linux; Android 14; SM-X900) AppleWebKit/537.36 Chrome/126 Safari/537.36', false],
      ['desktop Chrome', DESKTOP_UA, false],
    ])('%s', (_name, userAgent, expected) => {
      const restore = setNavigator({ userAgent, userAgentData: undefined, deviceMemory: undefined });
      try { expect(isPhoneClassDevice()).toBe(expected); } finally { restore(); }
    });

    it('treats a browser reporting itself as mobile, or with 4 GB RAM or less, as a phone', () => {
      let restore = setNavigator({ userAgent: DESKTOP_UA, userAgentData: { mobile: true }, deviceMemory: undefined });
      try { expect(isPhoneClassDevice()).toBe(true); } finally { restore(); }
      restore = setNavigator({ userAgent: DESKTOP_UA, userAgentData: undefined, deviceMemory: 4 });
      try { expect(isPhoneClassDevice()).toBe(true); } finally { restore(); }
      restore = setNavigator({ userAgent: DESKTOP_UA, userAgentData: undefined, deviceMemory: 8 });
      try { expect(isPhoneClassDevice()).toBe(false); } finally { restore(); }
    });
  });

  describe('detectAssistantModelCapability', () => {
    it('is unsupported with reason "phone" on a phone, even with WebGPU', () => {
      const restore = setNavigator({ userAgent: IPHONE_UA, userAgentData: undefined, deviceMemory: undefined, gpu: {} });
      try { expect(detectAssistantModelCapability()).toEqual({ supported: false, reason: 'phone' }); } finally { restore(); }
    });

    it('is supported on desktop with WebGPU, and reports no-webgpu without it', () => {
      let restore = setNavigator({ userAgent: DESKTOP_UA, userAgentData: undefined, deviceMemory: undefined, gpu: {} });
      try { expect(detectAssistantModelCapability()).toEqual({ supported: true }); } finally { restore(); }
      restore = setNavigator({ userAgent: DESKTOP_UA, userAgentData: undefined, deviceMemory: undefined, gpu: undefined });
      try { expect(detectAssistantModelCapability()).toEqual({ supported: false, reason: 'no-webgpu' }); } finally { restore(); }
    });
  });
});
