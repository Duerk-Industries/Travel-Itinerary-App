// The real package's index.js `require()`s .ttf font asset files, which this project's Jest
// setup has no transform for. Tests don't need real font loading — useFonts() resolves
// synchronously "loaded" so components render with whatever fontFamily name they asked for
// (RN just falls back silently if a named font isn't actually registered under jsdom).
export const useFonts = (): [boolean] => [true];
export const Fraunces_400Regular = 'Fraunces_400Regular';
export const Fraunces_500Medium = 'Fraunces_500Medium';
export const Fraunces_600SemiBold = 'Fraunces_600SemiBold';
export const Fraunces_600SemiBold_Italic = 'Fraunces_600SemiBold_Italic';
export const Fraunces_700Bold = 'Fraunces_700Bold';
