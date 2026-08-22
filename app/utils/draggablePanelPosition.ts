/**
 * Pure position/clamping math for the draggable assistant panel (see
 * AssistantChatPanel.tsx). Kept separate and dependency-free so it's
 * testable without simulating real pointer/touch gesture sequences.
 */

export type PanelPosition = { top: number; left: number };
export type ViewportSize = { width: number; height: number };
export type PanelSize = { width: number; height: number };

// Fallback used when `window` isn't available (non-browser/test
// environments) -- a plausible desktop viewport, not load-bearing for
// correctness since real usage always has a real window.
const FALLBACK_VIEWPORT: ViewportSize = { width: 1280, height: 800 };

export const getViewportSize = (): ViewportSize => {
  if (typeof window !== 'undefined' && window.innerWidth && window.innerHeight) {
    return { width: window.innerWidth, height: window.innerHeight };
  }
  return FALLBACK_VIEWPORT;
};

/**
 * The panel's resting position before the user ever drags it -- expressed
 * as top/left so it composes with drag deltas in one coordinate space,
 * but visually equivalent to the original fixed bottom/left placement.
 */
export const computeInitialPanelPosition = (
  viewport: ViewportSize,
  panel: PanelSize,
  margin: { bottom: number; left: number } = { bottom: 80, left: 16 }
): PanelPosition => ({
  top: Math.max(0, viewport.height - margin.bottom - panel.height),
  left: margin.left,
});

/**
 * Keeps the panel fully within the viewport. The panel survives close/
 * reopen (see AssistantChat.tsx) and window resizes don't reset it, so an
 * unclamped drag (or a resize after dragging near an edge) could otherwise
 * strand it somewhere the user can never get back to.
 */
export const clampPanelPosition = (
  position: PanelPosition,
  viewport: ViewportSize,
  panel: PanelSize
): PanelPosition => {
  const maxLeft = Math.max(0, viewport.width - panel.width);
  const maxTop = Math.max(0, viewport.height - panel.height);
  return {
    left: Math.min(Math.max(position.left, 0), maxLeft),
    top: Math.min(Math.max(position.top, 0), maxTop),
  };
};
