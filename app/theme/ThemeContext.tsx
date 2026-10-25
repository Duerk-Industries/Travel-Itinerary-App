import React, { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';
import { loadStoredAppearancePreference } from '../utils/appearancePreference';
import { getAppTheme, type AppTheme } from './theme';

/**
 * The resolved light or dark theme, for components that are not handed a `theme` prop. App.tsx provides it once at
 * the root. Standalone screens, including public blogs, follow the stored preference and system appearance.
 */
const ThemeContext = createContext<AppTheme | null>(null);

export const ThemeProvider: React.FC<{ theme: AppTheme; children?: React.ReactNode }> = ({ theme, children }) => (
  <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
);

export const useAppTheme = (): AppTheme => {
  const theme = useContext(ThemeContext);
  const systemScheme = useColorScheme?.() ?? null;
  return theme ?? getAppTheme(loadStoredAppearancePreference(), systemScheme);
};
