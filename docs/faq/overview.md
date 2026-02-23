# Overview FAQ

## What is this app, technically?

It is a monorepo with:

- `app/`: Expo + React Native Web client (`app/App.tsx`)
- `server/`: Express + TypeScript API (`server/src/app.ts`)
- Workspace scripts at repo root (`package.json`) for app/server tests and Playwright

The app supports trip planning across transfers (flights, trains, buses, private, ferry, other), lodging, tours, itinerary notes/details, expenses, ledger/cost reporting, groups, and account/family management.

Itinerary items now include a status lifecycle for transfers, lodging, tours, and rental cars:
- `Needed`
- `Proposed`
- `Booked`
- `Cancelled`
- `Completed`

Business required fields are relaxed for `Needed` and `Cancelled`, and enforced for `Proposed`, `Booked`, and `Completed`.

Voting is available for proposed itinerary items (transfers, lodging, tours, and car rentals).  
See `docs/faq/voting-on-items.md`.

