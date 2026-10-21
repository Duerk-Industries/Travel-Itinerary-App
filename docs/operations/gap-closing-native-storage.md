# Native encrypted storage and recovery

Implemented 2026-10-20 for gap-closing §§5.2–5.3. Web keeps its existing IndexedDB adapter. This covers saved trip snapshots and the retained financial expense queue, not every preference/session/media cache in the app.

## Build and rollout

Expo SDK 54 modules: `expo-sqlite ~16.0.10` with `useSQLCipher: true`, `expo-secure-store ~15.0.8` with Android backup exclusion enabled, and existing Expo Crypto. The shared Expo config registers both plugins for root and app builds. New Android/iOS development and production binaries are required; Expo Go and an OTA update to an older binary cannot supply SQLCipher. The store probes `cipher_version` and refuses plaintext fallback.

`NATIVE_ENCRYPTED_STORAGE=0` sets the independent build-config kill switch: native reads/writes are disabled with an error, without returning to AsyncStorage. It does not affect `NATIVE_MAP_RENDERER`. Enable only in a binary that passes the device gate below. Never downgrade a device with pending financial work to a legacy plaintext-writing binary; sync/export first.

## Data and keys

Each existing account/environment storage key hashes to its own database directory and SecureStore key identifier; raw owner/server identifiers do not appear in filenames. Every database has an independently generated 256-bit random key. Keys never enter snapshots, recovery exports or logs. SecureStore uses `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; foreground device unlock is required and migration to a new iOS device is disallowed. Existing biometric/PIN UI and 30-day offline access still apply. SecureStore errors (including a locked device) never cause key replacement.

Reads, schema initialization, migration, lease changes, expenses and tombstones use one keyed SQLite connection and `BEGIN IMMEDIATE` transactions. Operations serialize per scope. The connection closes after commit/rollback. Future schema versions are rejected. Expense bounds are 2,000 entries / 1,250,000 JSON characters and 10,000 retirement records; exceeding a bound fails without dropping entries. No snapshot eviction touches financial work.

Owner-bound v2 snapshots validate before migration; email-only v1 copies require fresh online download. Financial migration preserves IDs and operation keys. Plaintext is removed only after commit; cleanup interruption retries on later access. Queue tombstones prevent deleted/synced entries from being resurrected by a leftover legacy copy. A corrupt migration source is preserved until explicit repair backs it up in the same encrypted transaction as replacement. Unknown retirement history is not guessed.

## Recovery

- Lost/wrong snapshot key or unreadable snapshot database: offline loading returns no usable snapshot and the existing UI asks for online sign-in/download. Saving the trip again moves the closed database directory to an unreadable archive, retires the key, and commits a fresh authorized download. Archives remain on device; automatic cleanup does not touch financial databases.
- Lost/wrong expense key: reads, mutation, repair and replay stop. The error explains that unsynced work needs the original key. Export preserves encrypted database/journal bytes and any remaining legacy source, without including a key. It cannot decrypt missing-key data. The app never initializes an empty replacement queue over existing ciphertext. An unreadable queue also triggers the logout recovery dialog even if its count cannot be read.
- Corrupt queue with a usable database/key and verifiable retirement history: export first, then use the existing Repair/Restore UI. It preserves a backup before replacement, filters already handled IDs, and retains stable operation keys. Export/import remains account/environment bound. A user export of readable expenses contains private plaintext and is explicitly warned about.
- Snapshot logout erases the active database and its SecureStore key; retained financial queues/keys survive same-account sign-out. Explicit financial discard is a transaction and never bypasses an unreadable queue. Uninstall, Android backup restore or OS keystore loss may make unsynced work permanently unreadable. Sync or export before reinstall/device replacement. iOS keychain may survive reinstall; code handles either key/file presence combination conservatively.

## Acceptance still required on named Android and iOS devices

1. Build with the plugins; verify `cipher_version`, inspect database/journal bytes for absence of known private fixture strings, and prove an unkeyed connection cannot read them. Confirm SecureStore backup exclusion in generated Android configuration. Test builds without SQLCipher fail closed.
2. Upgrade an installed legacy build with saved trips and unsynced expenses. Kill during key creation, migration, commit and plaintext cleanup; relaunch and verify stable IDs, expense counts, no duplicate server writes, and cleanup only after commit. Include full disk, wrong owner/environment, malformed legacy rows and a future schema.
3. Lock/unlock, background, suspend, kill and resume during drain; verify lease fencing, bounded replay and account-switch/logout races. Retain on sign-out and restore only under the same account/environment. Confirm discard and snapshot/key removal.
4. Restore an encrypted database without its key, substitute an incorrect key, reinstall both with/without restored files, and simulate unavailable SecureStore. Prove redownload restores snapshots while unreadable financial work is preserved/exportable and never replayed or silently reset. Test migration/renderer flags independently.
5. Complete novice recovery/export/share testing, including the limits of ciphertext recovery and storage pressure caused by quarantined snapshots. Record device/OS/build IDs and actual outcomes before release.

Automated tests use a real SQLite engine (`sql.js`) with mocked native crypto/key/file APIs. They establish transaction/recovery behavior, not hardware encryption, keychain guarantees or native build compatibility.

References: [Expo SDK 54 SQLite / SQLCipher](https://github.com/expo/expo/blob/main/docs/pages/versions/v54.0.0/sdk/sqlite.mdx), [Expo SecureStore](https://docs.expo.dev/versions/v54.0.0/sdk/securestore/).

## Local validation

- Full frontend suite: 263 suites / 1,713 tests passed. After the final recovery/logout additions, the five focused suites passed again (32 tests).
- Frontend TypeScript and web production export passed.
- Android and iOS Hermes bundle exports passed from the workspace root with `EXPO_NO_SENTRY_METRO=1 npx expo export --platform android --platform ios --output-dir .artifacts/native-encryption-export`. The existing Metro config already disables Sentry's serializer for EAS because its native serializer can fail on an undefined bundle source; the same workaround is required for this local export. This is JavaScript/Hermes bundling, not a compiled native binary or device test.
- Native engine tests mock cipher/key/file interfaces and use SQLite transactions via `sql.js`. No hardware encryption/restore claims are inferred from them.
