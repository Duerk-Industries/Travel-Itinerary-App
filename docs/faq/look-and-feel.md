# Look and Feel FAQ

## What is the current UI style?

- Single-app shell with page-style navigation (`home`, `overview`, `flights`, `lodging`, `tours`, `expenses`, `ledger`, `trips`, etc.)
- Light theme with neutral gray/white surfaces and blue primary actions
- Card/table-centric layouts with rounded corners and compact controls
- Home screen hero imagery plus icon-labeled navigation rows

## Is the app cross-platform?

- Yes: web + native via Expo/React Native.
- Web uses HTML controls (`select`) in some flows.
- Native uses DateTimePicker where available, with text-input fallback.

## How is responsiveness handled?

- Flexible row/wrap layouts and scroll containers.
- Horizontal scroll support for wider desktop-style tables.

