import { createContext, useContext } from 'react';

/**
 * Space at the end of a page's own scroll area for the floating chat buttons on a phone, so the last item can
 * scroll clear of them while the page itself still runs down to the bottom tab bar. 0 when there are no buttons.
 */
export const PageScrollClearanceContext = createContext(0);

export const usePageScrollClearance = (): number => useContext(PageScrollClearanceContext);

/** A content-container style that adds the clearance, or null when there is none. */
export const scrollClearanceStyle = (clearance: number) => (clearance ? { paddingBottom: clearance } : null);

/** The floating buttons' 56px height plus the 24px gap they keep above the bottom bar. */
export const PAGE_FAB_CLEARANCE = 80;
