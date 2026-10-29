# App theme and styling

`app/theme/theme.ts` owns the app's presentation definitions for web, iOS, and Android:

- Both color palettes, typography, spacing, fonts, and fixed layout measurements.
- `buildStyles(theme)`, the shared named stylesheet used by the app shell and tabs.
- `themeStyle(name, values, theme)`, the registry of component styles. Definitions are grouped by their source screen or component. Its values argument supplies runtime measurements, animation values, and component state; visual rules belong in the registry.
- Map layers, avatar colors, error screens, document layout, and HTML/CSS for printable itineraries, packing lists, and keepsakes.

Components may combine named styles and pass runtime values to a registered definition. They must not define local styles, hardcode colors, or mutate shared styles. Add or update the definition in `theme.ts` instead. Existing utility imports for table columns, table layout, and shadows are compatibility exports of the central definitions.

## Appearance

`ThemeProvider` supplies the resolved preference. `useAppTheme()` also supports standalone screens, including the anonymous public blog reader: the stored preference wins over system appearance, and Auto follows the system. `resolveComponentTheme()` fills older partial theme props from the active theme. Memoized component styles include the theme in their dependencies.

Use semantic color pairs:

| Purpose | Background | Text |
| --- | --- | --- |
| Standard content | `surface`, `surfaceMuted` | `text`, `textMuted` |
| Links | Standard surfaces | `linkText` |
| Main action | `cta` | `onCta` |
| Selected control | `selectedSurface` | `onSelected` |
| Settlement/highlight | `accentSurface` | `text`, `textMuted` |
| Status message | `dangerSurface`, `successSurface`, `warningSurface`, `premiumSurface` | Matching `*Text` token |
| Solid status action | Matching `*Action` token | `onAccent` |

The screen palettes use neutral graphite colors with mode-specific CTA gradients (`ctaGradientStart` / `ctaGradientEnd`), matching `onCta` text, and muted gold premium accents. Previous color values are preserved beside the tokens in comments. Placeholder card pairs and the translucent white Change Trip pill also live in `theme.ts`. Use `linkText` for link labels. Exported documents have their own centralized paper palettes, so printing does not inherit a dark screen background. Brand logo colors are also defined centrally and retain their required colors.

## Checks

`themeCentralization.test.ts` rejects new local color literals, inline style overrides, and component stylesheet definitions. It checks token coverage, contrast, action/selection pairs, avatar labels, error screens, settlement colors, and style caching in both modes. `themePropagation.test.tsx` verifies that a dialog updates when its provider changes appearance.

Browser coverage in `mobile-input-regressions.test.ts` checks light/dark appearance at phone and laptop widths, public blogs without authentication, downloads, keyboard access, dropdowns, and packing headers. Screenshots are saved under `output/playwright/`.
