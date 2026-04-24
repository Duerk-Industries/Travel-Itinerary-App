import fs from 'node:fs';
import path from 'node:path';

/**
 * Belt-and-suspenders guard for the message_reads retirement migration.
 *
 * The file lives at `server/migrations/20260425_drop_message_reads.sql.pending`
 * with a `.pending` suffix so the runtime migration runner — which only
 * picks `*.sql` — skips it. If a PR accidentally renames to plain `.sql`
 * before the CHAT_LEGACY_READS_ENABLED flag is flipped off across all
 * instances, every chat unread-count read will immediately fall off a
 * cliff. This test fails loudly if that renaming happens without also
 * clearing the explanatory TODO, so reviewers have to acknowledge the
 * change.
 */

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const PENDING_FILENAME = '20260425_drop_message_reads.sql.pending';
const PROMOTED_FILENAME = '20260425_drop_message_reads.sql';

describe('message_reads drop migration', () => {
  it('ships as a .sql.pending file so the auto-apply runner skips it', () => {
    const pendingExists = fs.existsSync(path.join(MIGRATIONS_DIR, PENDING_FILENAME));
    const promotedExists = fs.existsSync(path.join(MIGRATIONS_DIR, PROMOTED_FILENAME));
    // Exactly one of the two should exist at any point in time. The normal
    // state is `pending`; the promoted state is a deliberate cutover PR.
    expect(pendingExists !== promotedExists).toBe(true);

    if (promotedExists) {
      const promoted = fs.readFileSync(path.join(MIGRATIONS_DIR, PROMOTED_FILENAME), 'utf8');
      // If the file has been promoted, the deprecation TODO block must be
      // removed so reviewers are forced to re-read the entire migration.
      expect(promoted).not.toMatch(/STATUS:\s*\*\*pending\*\*/);
    }
  });

  it('the runner ignores .pending files (reads .sql only)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { listMigrationFiles } = require('../src/migrations/runner') as typeof import('../src/migrations/runner');
    const files = listMigrationFiles(MIGRATIONS_DIR);
    const names = files.map((f) => f.name);
    expect(names).not.toContain(PENDING_FILENAME);
    // Also sanity-check: no `.pending` or other non-.sql file sneaked in.
    for (const name of names) {
      expect(name.endsWith('.sql')).toBe(true);
    }
  });
});
