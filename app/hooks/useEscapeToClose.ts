/**
 * Closes an overlay on Escape keypress.
 *
 * React Native's `Modal` already handles `onRequestClose`, but several
 * overlays in this app are plain `View` stacks that never get an escape
 * affordance. This hook plugs that gap for keyboard users on web.
 *
 * DOM-presence is the gate — on native platforms `document` is undefined
 * and the hook is a no-op.
 */
import { useEffect } from 'react';

export const useEscapeToClose = (
  visible: boolean,
  onClose: (() => void) | undefined,
): void => {
  useEffect(() => {
    if (!visible || !onClose) return undefined;
    if (typeof document === 'undefined') return undefined;

    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [visible, onClose]);
};

export default useEscapeToClose;
