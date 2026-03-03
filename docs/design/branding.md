# WanderBunnies Branding

This project uses WanderBunnies for user-visible branding while retaining existing development IDs (slug, scheme, bundle IDs).

## Asset mapping

- App icon + favicon image: `docs/design/Assets/WanderBunnies App Icon.png`
- Splash screen image: `docs/design/Assets/WanderBunnies Splash Screen.png`
- Top banner icon image: `docs/design/Assets/WanderBunnies Reference Image.png`

## Runtime asset locations

- Expo assets:
  - `app/assets/wanderbunnies-app-icon.png`
  - `app/assets/wanderbunnies-splash-screen.png`
  - `app/assets/wanderbunnies-reference.png`
- Web public assets:
  - `server/public/favicon.png`
  - `server/public/apple-touch-icon.png`
  - `server/public/assets/wanderbunnies-app-icon.png`

## Configuration points

- Expo config: `app/app.config.ts`
  - `name: "WanderBunnies"`
  - `icon`
  - `splash.image`
  - `web.favicon`
- Web document metadata: `server/public/index.html`
  - `<title>WanderBunnies</title>`
  - favicon + apple touch icon link tags
- App top banner title and icon: `app/App.tsx`
