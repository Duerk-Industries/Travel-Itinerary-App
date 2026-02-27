# Travel App Design System Guide

## Purpose

This document defines the UI, UX, and visual system for the travel
itinerary and collaboration platform.\
It is intended for: - UX designers - Software developers -
AI/LLM-assisted development - Product and analytics teams

The system prioritizes: - Exploration and trust - Clean and modern
design - Collaboration and social travel - Data clarity and scalability

------------------------------------------------------------------------

## Brand Principles

1.  Trust and intelligence
2.  Exploration and adventure
3.  Premium but accessible
4.  Calm and focused user experience
5.  Collaborative and social-first

------------------------------------------------------------------------

# Color System

## Primary Palette

-   Deep Blue: #152944
-   Pacific Blue: #45B7C6
-   Olive Leaf: #5E6B3F

## Neutrals

-   Snow White: #FAFCFD
-   Soft Fog: #F2F5F7
-   Mist Gray: #E6ECEF

## Accent Colors

-   Sunset: #F59E0B (Primary CTA)
-   Coral: #E76F51 (Urgency, alerts)
-   Burnt Gold: #D97706 (Premium tier)

## Semantic

-   Success: #2E7D32
-   Warning: #ED6C02
-   Error: #C62828
-   Info: #0288D1

------------------------------------------------------------------------

# UI Structure

## Navigation

Use Deep Blue for primary navigation. Includes: - Trip switcher -
Following trips - Notifications - Premium badge - Profile

------------------------------------------------------------------------

## Itinerary Cards

Card color mapping: - Ticketed → Sunset - Reservation → Coral - Tour →
Pacific Blue - Open access → Olive - Event → Burnt Gold

Each card includes: - Title - Date and time - Location - Notes -
Attendees - Status

------------------------------------------------------------------------

## Activity Feed

Key collaboration feature.

Each activity: - Color-coded left border - Avatar - Timestamp - Action
summary - Comments and reactions

Mapping: - Booking → Sunset - Comment → Pacific Blue - Update → Olive -
Alert → Coral

------------------------------------------------------------------------

## Following Trips

Follower view is neutral and read-only. Members see full interactive UI.

------------------------------------------------------------------------

## Maps

Marker logic: - Default → Pacific Blue - Nature → Olive - Active →
Sunset - Alerts → Coral

------------------------------------------------------------------------

# Accessibility

-   4.5 contrast minimum
-   Color never sole indicator
-   Dark mode support
-   Color blind chart modes

------------------------------------------------------------------------

# Motion and Interaction

-   Smooth transitions
-   150--250ms
-   Subtle elevation
-   Natural easing

------------------------------------------------------------------------

# Premium Tier

Burnt Gold used for: - Loyalty - Upgrades - Badges - Exclusive features

------------------------------------------------------------------------

# LLM Guidance

When generating UI or layouts: 1. Use consistent color mapping. 2.
Maintain card-based layout. 3. Prioritize readability and hierarchy. 4.
Ensure collaboration-first design. 5. Respect accessibility rules.

------------------------------------------------------------------------

# Developer Notes

Use tokens and theme architecture. Ensure light and dark parity. Keep
components modular and reusable.
