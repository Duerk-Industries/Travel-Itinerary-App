/**
 * @jest-environment jsdom
 */
import {
  clampPanelPosition,
  computeInitialPanelPosition,
  getViewportSize,
} from '../utils/draggablePanelPosition';

const VIEWPORT = { width: 1000, height: 800 };
const PANEL = { width: 360, height: 480 };

describe('computeInitialPanelPosition', () => {
  it('places the panel at the bottom-left, matching the original fixed placement', () => {
    const position = computeInitialPanelPosition(VIEWPORT, PANEL);
    expect(position).toEqual({ top: 800 - 80 - 480, left: 16 });
  });

  it('never places the panel above the top of the viewport on a very short screen', () => {
    const position = computeInitialPanelPosition({ width: 1000, height: 400 }, PANEL);
    expect(position.top).toBe(0);
  });

  it('respects a custom margin', () => {
    const position = computeInitialPanelPosition(VIEWPORT, PANEL, { bottom: 0, left: 0 });
    expect(position).toEqual({ top: 800 - 480, left: 0 });
  });
});

describe('clampPanelPosition', () => {
  it('leaves an in-bounds position untouched', () => {
    const position = { top: 100, left: 100 };
    expect(clampPanelPosition(position, VIEWPORT, PANEL)).toEqual(position);
  });

  it('clamps a position dragged past the left/top edges back to 0', () => {
    expect(clampPanelPosition({ top: -50, left: -100 }, VIEWPORT, PANEL)).toEqual({ top: 0, left: 0 });
  });

  it('clamps a position dragged past the right/bottom edges so the panel stays fully visible', () => {
    const clamped = clampPanelPosition({ top: 10000, left: 10000 }, VIEWPORT, PANEL);
    expect(clamped).toEqual({
      left: VIEWPORT.width - PANEL.width,
      top: VIEWPORT.height - PANEL.height,
    });
  });

  it('never produces a negative max bound when the panel is larger than the viewport', () => {
    const tinyViewport = { width: 200, height: 200 };
    const clamped = clampPanelPosition({ top: 500, left: 500 }, tinyViewport, PANEL);
    expect(clamped).toEqual({ top: 0, left: 0 });
  });
});

describe('getViewportSize', () => {
  it('reads real window dimensions when available', () => {
    const original = { innerWidth: window.innerWidth, innerHeight: window.innerHeight };
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
    try {
      expect(getViewportSize()).toEqual({ width: 1440, height: 900 });
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: original.innerWidth, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: original.innerHeight, configurable: true });
    }
  });
});
