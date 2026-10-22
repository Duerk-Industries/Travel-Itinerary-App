import React, { createContext, useContext } from 'react';
import { getAppTheme, type AppTheme } from './theme';

/**
 * The resolved light or dark theme, for components that are not handed a `theme` prop. App.tsx provides it once at
 * the root. Without a provider (tests, isolated screens) it is the light theme, so text is still readable.
 */
const ThemeContext = createContext<AppTheme>(getAppTheme('light', 'light'));

export const ThemeProvider: React.FC<{ theme: AppTheme; children?: React.ReactNode }> = ({ theme, children }) => (
  <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
);

export const useAppTheme = (): AppTheme => useContext(ThemeContext);
