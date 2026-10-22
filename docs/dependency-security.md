# Dependency security

Last checked: 2026-10-22, using npm's advisory database.

The root workspace, standalone app, standalone server, and Firebase Functions
lockfiles are audited separately. Deployments can use the standalone lockfiles,
so updating only the workspace lockfile does not fix every build.

## Fixed in this update

- Removed unused `update` and `upgrade` command-line packages and their vulnerable
  dependency trees.
- Updated compatible dependency versions, including Axios, Sharp/libvips,
  Handlebars, gRPC, multipart parsing, Express's proxy/query parsing dependencies,
  PostCSS, shell-quote, and source-map-js.
- Updated vulnerable overrides in the standalone app and Functions manifests.
- Replaced Functions' unsupported npm `workspace:*` reference with the equivalent
  local `file:` reference so its manifest and lockfile can be installed together.
- Preserved Expo SDK 54 and React/React DOM 19.1.0; deduplicated React DOM and
  expo-asset after the Expo patch update.

The server and Functions production-only audits (`npm audit --omit=dev
--no-workspaces`, run inside each directory) report zero vulnerabilities.

| Lockfile | Full-audit findings before | After | Critical findings after |
| --- | ---: | ---: | ---: |
| Root workspace | 97 | 46 | 0 |
| Standalone app | 52 | 44 | 0 |
| Standalone server | 38 | 29 | 0 |
| Firebase Functions | 37 | 9 | 0 |

## Remaining upstream advisories

Full audits still exit nonzero. Their remaining findings originate from these
two packages; npm also counts packages that depend on them as affected.

| Package | Advisory | Status and dependency path |
| --- | --- | --- |
| `braces` 3.0.3 | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | No published patched release. Used through micromatch in Jest/Metro and Functions' lint/test tooling. Deeply nested untrusted patterns can exhaust the stack. |
| `node-forge` 1.4.0 | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | No published patched release. Used by Expo CLI/development certificate tooling. RSA signature verification has an ASN.1 validation flaw. |

These findings are unresolved, not suppressed or repaired by a local patch.
Do not treat the successful production-only backend audits as a clean audit of
the entire repository. Recheck the advisories when updating Expo, Metro, Jest,
or lint tooling. Avoid sending untrusted glob patterns to the affected tooling.

## Verification

- Full workspace TypeScript checks passed.
- Selected auth, health, image/media, blog rendering, Sentry, and session tests
  passed (44 tests).
- Expo Doctor passed all 18 checks.
- npm 10.8.2 clean-install dry runs passed for all four lockfiles.

The separate Functions build does not currently pass: `functions/src/index.ts`
references undefined `RAW_CSV_PREFIX`, Plaid sources have unused imports and an
incompatible webhook request field, and `@types/request` disagrees with the
installed tough-cookie declarations. These source/type issues are outside the
dependency security changes and still need to be resolved before deployment.

Run `npm audit` from the workspace root, then `npm audit --no-workspaces` from
each of `app`, `server`, and `functions` to reproduce the full audits. The
repository's `audit=false` setting disables automatic install-time audits;
explicit `npm audit` commands still run and report the unresolved advisories.
