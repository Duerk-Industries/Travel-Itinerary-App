# Component Specifications (Travel App)

This file defines **behavior**, **states**, **props**, **layout rules**, and **token usage** for core UI components.
Use it as a build contract for UX, engineering, and LLM-generated code.

---

## Global Component Rules
- Never hardcode colors; use `theme.colors.*` (RN) or CSS variables / Tailwind tokens (web).
- All touch targets: **44x44pt minimum**.
- Default radius: `radius-xl` for cards; `radius-md` for inputs and buttons.
- Motion: 150–250ms, standard easing.

---

## 1) Buttons

### Variants
1. **Primary CTA** (use `cta`)
2. **Secondary** (outline, uses `link`)
3. **Tertiary** (text-only, uses `link`)
4. **Danger** (uses `error`)
5. **Premium** (uses `premium`)

### States
- Default
- Hover (web)
- Pressed (mobile)
- Disabled
- Loading
- Focus-visible (web)

### Layout
- Height: 44 (min)
- Padding: 14–16 horizontal, 10–12 vertical
- Icon optional (left or right)
- Label text: 16, weight 600

### Token mapping
- Background: Primary CTA -> `theme.colors.cta`
- Text: on solid -> `#0B1726` in light mode, `#0B1726` acceptable; otherwise use `theme.colors.text`
- Disabled: reduce opacity to ~0.5 and remove shadow.

### Props (recommended)
- `variant: "primary" | "secondary" | "tertiary" | "danger" | "premium"`
- `size: "sm" | "md" | "lg"` (default md)
- `iconLeft`, `iconRight`
- `loading`, `disabled`
- `onPress`

---

## 2) Modal / Bottom Sheet

### Use cases
- Invite to trip
- Add activity
- Edit reservation
- Confirm delete
- Upgrade to premium

### Structure
- Scrim overlay
- Header (title + close)
- Body (content)
- Footer (actions)

### Behavior
- Mobile: bottom sheet (70–90% height)
- Web: centered modal (max width 560px)
- Dismiss: close icon + scrim tap (except destructive confirm)

### Tokens
- Surface: light -> `surface`; dark -> `card`
- Title: `text`
- Primary action button uses CTA tokens

### Accessibility
- Focus trap (web)
- Screen reader label for close

---

## 3) Itinerary Card

### Purpose
Single activity unit (Ticketed, Reservation, Tour, Open Access, Event).

### Card layout
- Left color bar (6px) based on activity type
- Title
- Time + duration
- Location line
- Chips: category, booking status, cost
- Expand/collapse for notes and attachments
- Actions: edit, share, mark done

### Activity Type Color Mapping (Light)
- Ticketed: Sunset (`cta`)
- Reservation: Coral (`alert`)
- Tour: Pacific Blue (`link`)
- Open Access: Olive (`nature`)
- Event: Burnt Gold (`premium`)

### States
- Default
- Expanded
- Completed (subtle check + reduced emphasis)
- Past due / conflict (alert badge)
- Disabled (read-only follower)

### Props (recommended)
- `type`, `title`, `start`, `end`, `location`, `notes`
- `status: "planned" | "booked" | "done" | "canceled"`
- `role: "member" | "follower"`
- `onPress`, `onEdit`, `onShare`, `onToggleDone`

---

## 4) Activity Feed Item

### Purpose
Collaborative timeline of changes: comments, updates, bookings, photos.

### Feed item layout
- Left colored border (4px)
- Avatar
- Title line (actor + action)
- Timestamp
- Content (text, attachment preview, activity reference)
- Reaction row + comment entry

### Feed type mapping
- Booking: Sunset
- Comment: Pacific Blue
- Update: Olive
- Alert: Coral

### Behavior
- Infinite scroll
- New items animate in (subtle)
- “Jump to latest” button when scrolled up

### Props (recommended)
- `actorName`, `actorAvatarUrl`
- `eventType`, `timestamp`
- `summary`, `detail`
- `attachments[]`
- `reactions[]`, `comments[]`

---

## 5) Follow Trip Header + Summary

### Purpose
High-level overview for followers and members.

### Layout
- Trip title
- Date range
- Current city
- Next up card (uses itinerary card styling)
- Tabs: Itinerary | Feed | Map | People

### Role behavior
- Follower: read-only; show lock icon on edit buttons and premium prompts
- Member: full interaction

---

## 6) Map Marker + Callout

### Marker colors
- Default: Pacific Blue
- Nature: Olive
- Active selection: Sunset
- Alert: Coral

### Callout
- Title
- Time
- “Open in itinerary” deep link
- “Directions” action

---
