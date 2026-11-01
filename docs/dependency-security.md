# Dependency security

Last checked: 2026-11-01, using npm's advisory database.

Audit the root workspace and each standalone lockfile separately. The app,
server container, and Firebase Functions can install independently, so fixing
only the root lockfile does not cover every build.

## Current fixes

- Updated the glob and minimatch overrides to 14.0.2 and 11.0.1 for the
  cancellation and pattern amplification denial-of-service advisories.
- Updated test-exclude to 8.0.0 alongside those overrides. Its current API
  supports the modern glob/minimatch exports; Jest coverage was verified.
- Updated pinned body-parser to 1.20.9 and qs to 6.16.2. These address the
  compressed-body crash and query-string serialization denial of service.
- Refreshed compatible standalone transitive dependencies, including
  node-forge, re2js, fast-uri, follow-redirects, multer, and Zod.
- Removed stale nested vulnerable glob, minimatch, and UUID resolutions from
  the workspace lockfile, and refreshed all four lockfiles.
- Kept Expo SDK 54, React Native 0.81.5, React 19.1.0, and Jest 29.

## Remaining audit findings

| Lockfile | Low | Moderate | High | Critical |
| --- | ---: | ---: | ---: | ---: |
| Root workspace | 21 | 0 | 0 | 0 |
| Standalone app | 21 | 0 | 0 | 0 |
| Standalone server | 7 | 0 | 0 | 0 |
| Firebase Functions | 6 | 0 | 0 | 0 |

The root workspace full audit decreased from 54 to 21 findings. All remaining
findings originate in deepmerge 4.3.1 and its dependent packages. The
[prototype poisoning advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
has no published patched release. It affects Jest configuration and Expo
configuration tooling. These findings remain unresolved; they are not fixed
by filtering the audit output or forcing an unrelated Expo/Jest version change.

## Verification

- Clean-directory npm ci dry runs passed for all four lockfiles, with scripts
  disabled so the checks do not require a complete source checkout.
- App TypeScript and server production build passed.
- Targeted frontend and backend tests passed; Jest coverage generation passed.
- Expo web export and patch-package application passed.

The separate Functions build still has the previously documented source/type
errors: undefined RAW_CSV_PREFIX, unused Plaid imports, an incompatible Plaid
webhook request field, and conflicting request/tough-cookie declarations.
These are outside this dependency update.

Reproduce the full audits with npm audit at the root and npm audit
--no-workspaces inside app, server, and functions. Full audits still exit
nonzero for the low-severity deepmerge findings. The repository's audit=false
setting disables automatic install-time audits; explicit npm audit commands
still report them.
