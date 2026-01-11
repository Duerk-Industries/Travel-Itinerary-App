# Shared-Trip-Planner

A starter shared trip planner stack with a TypeScript/Node.js API backed by PostgreSQL and an Expo (React Native) client that runs on web, Android, and iOS. Flights are tied to the authenticated user but can be shared with other accounts via email.

## What's inside
- **server**: Express API with JWT auth, PostgreSQL schema for flights, and endpoints to add/remove/share flights.
- **app**: Expo application with Apple/Google/email login flows and a simple UI to list and manage flights across web, Android, and iOS.

## Getting started
1. Install dependencies (workspace aware):
   ```bash
   npm install
   ```
2. Configure the API:
   - Copy `server/.env.example` to `server/.env` and update `DATABASE_URL` for your PostgreSQL instance and `AUTH_SECRET` for JWT signing.
   - Ensure PostgreSQL is running and accessible.
3. Run the API (from repo root):
   ```bash
   cd server
   npm run dev
   ```
   The server will create the required tables on startup.
   - To enable sharing emails, set these in `server/.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, and optionally `SMTP_USER`/`SMTP_PASS` if your SMTP server requires auth.
4. Configure the Expo app:
   - Set `BACKEND_URL` in your shell when running the client (defaults to `http://localhost:4000`).
   - Replace the placeholder Google client IDs in `app/App.tsx` and update bundle identifiers in `app/app.config.ts` for production.
   - Enable Apple sign-in in your Apple developer settings if targeting iOS hardware.
5. Start the client (from repo root):
   ```bash
   cd app
   npm run web # or npm run ios / npm run android
   ```

## Test Google login locally
1. Start the backend on port 4000:
   ```bash
   cd server
   npm run dev
   ```
2. Start the frontend on port 8081:
   ```bash
   cd app
   npm run web
   ```
3. Click the Google login button on the login screen.
4. After the redirect completes, visit `http://localhost:4000/auth/me` and confirm you see user JSON.

Troubleshooting:
- If `req.user` is undefined after the callback, confirm `express-session` and `passport.session()` are registered before routes.
- For local dev, set the session cookie to `sameSite: 'lax'` (already applied in `server/src/app.ts`).

## API quick reference
- `POST /api/auth/email { email }` → create/login a user via email, returning a JWT.
- `POST /api/auth/oauth { email, provider }` → Google or Apple login using the provider name and email claim.
- `GET /api/flights` → list flights for the authenticated user.
- `POST /api/flights` → add a flight with passenger, dates/times, layover, carrier/number, booking reference, and cost.
- `PATCH /api/flights/:id` → update a flight's details.
- `DELETE /api/flights/:id` → remove a flight owned by the user.
- `POST /api/flights/:id/share { email }` → share a flight with another account by email.
- `POST /api/groups { name, members[] }` → create a group and invite users/guests (members use `email` for existing users or `guestName` for non-login members).
- `GET /api/groups/invites` → list pending group invites for the authenticated user.
- `POST /api/groups/invites/:id/accept` → accept a pending group invite.
- `GET /api/groups?sort=name|created` → list groups the user belongs to, with members.
- `POST /api/groups/:id/members { email | guestName }` → add a member (existing user via email -> invite; guest added directly).
- `DELETE /api/groups/:groupId/members/:memberId` → remove a member (owner only; owner cannot be removed).
- `DELETE /api/groups/invites/:id` → cancel a pending invite (group owner).
- `DELETE /api/groups/:id` → delete a group (owner only).
- `GET /api/groups/:id/members` → list group members (must be in group).
- `GET /api/trips` → list trips in groups the user belongs to.
- `POST /api/trips { name, groupId }` → create a trip under a group the user is in.
- `DELETE /api/trips/:id` → delete a trip (must belong to the group).
- `PATCH /api/trips/:id/group { groupId }` → move a trip to another group the user belongs to.

## Notes
- This project is a base implementation; plug in real OAuth client IDs/secrets and production storage for secure deployments.
- The Expo client uses React Native Web so the same code runs on web, Android, and iOS.
