/// <reference types="jest" />
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

/**
 * Drift guard for the Postgres schema bootstrap.
 *
 * `server/src/db.postgres.ts` historically creates every schema object
 * inline via `CREATE TABLE IF NOT EXISTS` inside `initDb()`. We have a
 * migration runner + migration directory (see migrationRunner.test.ts), but
 * existing tables still live inline. New tables SHOULD go into a migration
 * file rather than being added inline.
 *
 * This test doesn't force immediate cutover — it freezes the current set of
 * inline-created tables as a snapshot. New inline tables fail the test
 * loudly, forcing a PR author to either:
 *   (a) add the migration file and remove the inline CREATE, or
 *   (b) consciously extend this snapshot if genuine bootstrap-time creation
 *       is still required.
 *
 * Removing a table from the inline set without updating the snapshot also
 * fails — that forces a second reviewer look at data-destroying changes.
 */

const POSTGRES_ADAPTER_PATH = path.join(__dirname, '..', 'src', 'db.postgres.ts');
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// Snapshot of every `CREATE TABLE IF NOT EXISTS <name>` that currently lives
// inline in `db.postgres.ts`. Keep alphabetical for diff readability.
const EXPECTED_INLINE_TABLES: ReadonlySet<string> = new Set([
  'airports',
  'api_cost_counters',
  'api_usage_counters',
  'audit_log',
  'car_rentals',
  // 'chat_read_watermarks' — moved to server/migrations/20260425_add_chat_read_watermarks.sql
  // (Priority 10 pilot). Auto-applied by the runtime migration runner.
  // 'email_verifications' — moved to server/migrations/20260426_add_email_verifications.sql
  'expenses',
  'family_relationships',
  'feature_flags',
  'features',
  // 'fellow_travelers' — moved to server/migrations/20260426_add_fellow_travelers.sql
  'flight_shares',
  'flights',
  'follow_codes',
  'generation_idempotency',
  'group_invites',
  'group_members',
  'groups',
  'item_votes',
  'itineraries',
  'itinerary_details',
  'locations',
  'lodgings',
  'message_reads',
  // 'place_details_cache' — moved to server/migrations/20260426_add_place_details_cache.sql
  'place_lookup_cache',
  'tier_entitlements',
  'tier_limits',
  'tiers',
  'tours',
  'traits',
  'trip_activity',
  'trip_comments',
  'trip_followers',
  'trip_messages',
  'trip_payments',
  'trip_packing_item_checks',
  'trip_packing_list_items',
  'trip_removals',
  'trip_share_invites',
  'trips',
  'universal_packing_list_items',
  'usage_counters',
  'usage_events',
  'user_email_verifications',
  'user_emails',
  'user_packing_list_items',
  'user_tiers',
  'users',
  'web_users',
]);

const extractInlineTables = (source: string): Set<string> => {
  const names = new Set<string>();
  // Match `CREATE TABLE IF NOT EXISTS <name>` tolerating extra whitespace.
  const re = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = re.exec(source)) !== null) {
    names.add(match[1]);
  }
  return names;
};

describe('Postgres schema drift guard', () => {
  it('the set of inline `CREATE TABLE IF NOT EXISTS` tables matches the committed snapshot', () => {
    const source = fs.readFileSync(POSTGRES_ADAPTER_PATH, 'utf8');
    const found = extractInlineTables(source);
    const expected = EXPECTED_INLINE_TABLES;

    const newTables = [...found].filter((t) => !expected.has(t)).sort();
    const removedTables = [...expected].filter((t) => !found.has(t)).sort();

    const message = [
      newTables.length ? `New inline tables detected (add via migration or update the snapshot): ${newTables.join(', ')}` : null,
      removedTables.length ? `Inline tables removed from db.postgres.ts without updating the snapshot: ${removedTables.join(', ')}` : null,
    ].filter(Boolean).join('\n');

    if (newTables.length || removedTables.length) {
      throw new Error(message || 'schema drift detected');
    }
  });

  it('every .sql file in server/migrations/ parses as real SQL (catches empty/typo-only migrations)', () => {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
      return;
    }
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').trim();
      expect(sql.length).toBeGreaterThan(0);
      // Must contain at least one DDL keyword. Prevents a migration file from
      // silently being empty or a stray comment-only file slipping in.
      expect(sql.toUpperCase()).toMatch(/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/);
    }
  });

  it('forward-only migrations never contain a DROP statement (rollbacks belong in a companion .rollback.sql)', () => {
    // server/migrations/runner.ts executes a migration file's raw contents
    // verbatim inside one BEGIN/COMMIT — it does not parse or strip "-- Up"
    // / "-- Down" comment markers. Two migrations (20260216_add_trip_activity
    // and 20260217_add_trip_comments) used to embed both an "Up" CREATE
    // section AND a "Down" DROP section in the same file; on any environment
    // where the migration hadn't already run and been recorded in
    // schema_migrations (e.g. a fresh pg-mem instance created per test run,
    // or a brand-new production database), the runner executed the DROP
    // immediately after the CREATE, silently deleting the table/index it had
    // just created. The current convention is a pure "Up" `<name>.sql` plus
    // a separate `<name>.rollback.sql` (which the runner explicitly skips).
    if (!fs.existsSync(MIGRATIONS_DIR)) {
      return;
    }
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && !f.toLowerCase().endsWith('.rollback.sql'))
      .sort();
    const offenders: string[] = [];
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      if (/\bDROP\s+(TABLE|INDEX|COLUMN|CONSTRAINT)\b/i.test(sql)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
