import { createContext, useContext } from 'react';

/**
 * Extra bottom space floating buttons (trip chat, AI helper) keep clear, so they sit above
 * the phone bottom tab bar instead of covering it. 0 when no bar is shown.
 */
export const FloatingInsetContext = createContext(0);

export const useFloatingInset = (): number => useContext(FloatingInsetContext);
