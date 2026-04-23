import fs from 'node:fs';
import path from 'node:path';

export type MigrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
};

export type MigrationFile = {
  name: string;
  path: string;
  sql: string;
};

export type RunMigrationsResult = {
  applied: string[];
  alreadyApplied: string[];
};

export const ensureMigrationsTable = async (client: MigrationClient): Promise<void> => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
};

export const listAppliedMigrations = async (client: MigrationClient): Promise<Set<string>> => {
  const res = (await client.query(
    `SELECT name FROM schema_migrations ORDER BY name ASC`
  )) as { rows: Array<{ name: string }> };
  return new Set((res.rows ?? []).map((r) => r.name));
};

export const listMigrationFiles = (dir: string): MigrationFile[] => {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
  return files.map((name) => ({
    name,
    path: path.join(dir, name),
    sql: fs.readFileSync(path.join(dir, name), 'utf8'),
  }));
};

export const runMigrations = async ({
  client,
  dir,
  log,
}: {
  client: MigrationClient;
  dir: string;
  log?: (message: string) => void;
}): Promise<RunMigrationsResult> => {
  const emit = log ?? (() => {});
  await ensureMigrationsTable(client);
  const applied = await listAppliedMigrations(client);
  const files = listMigrationFiles(dir);
  const newlyApplied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (applied.has(file.name)) {
      skipped.push(file.name);
      continue;
    }
    emit(`[migrations] applying ${file.name}`);
    await client.query('BEGIN');
    try {
      await client.query(file.sql);
      await client.query(
        `INSERT INTO schema_migrations (name) VALUES ($1)`,
        [file.name]
      );
      await client.query('COMMIT');
      newlyApplied.push(file.name);
      emit(`[migrations] applied ${file.name}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error(
        `Failed to apply migration ${file.name}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return { applied: newlyApplied, alreadyApplied: skipped };
};
