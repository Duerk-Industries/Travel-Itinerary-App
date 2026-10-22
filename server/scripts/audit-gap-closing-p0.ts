/** Read-only source audit. --provider=postgres|firebase additionally reads the
 * explicitly configured deployment. Never initializes/seeds/migrates a DB. */
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { getFeatureFlagSeeds } from '../src/config/featureFlags';
import { getEnvValue } from '../src/env';
import { getFirebaseDb } from '../src/ingestion/shared/repository';

const root = path.resolve(__dirname, '../..');
const arg = (name: string): string | undefined => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const files = (folder: string): string[] => fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() && !['node_modules', 'dist', 'tests', '__tests__', '.expo'].includes(entry.name) ? files(path.join(folder, entry.name))
    : entry.isFile() && /\.tsx?$/.test(entry.name) ? [path.join(folder, entry.name)] : []);

const main = async (): Promise<void> => {
  const sources = [...files(path.join(root, 'server/src')), ...files(path.join(root, 'app'))].map(file => ({
    file: path.relative(root, file).replace(/\\/g, '/'), source: fs.readFileSync(file, 'utf8'),
  }));
  const seeds = getFeatureFlagSeeds();
  const deployed = new Map<string, boolean>();
  let artifactPaths: string[] | null = null;
  let consensus: unknown = { status: 'Not measured; review existing admin comparison data before changing the sample rate.' };
  const provider = arg('provider');
  if (provider === 'postgres') {
    const pool = new Pool({ connectionString: getEnvValue('DATABASE_URL', { required: true }) });
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      (await client.query<{ key: string; enabled: boolean }>('SELECT key,enabled FROM feature_flags')).rows.forEach(flag => deployed.set(flag.key, flag.enabled));
      artifactPaths = (await client.query<{ gcs_path: string }>('SELECT gcs_path FROM blog_day_map_artifacts')).rows.map(row => row.gcs_path);
      consensus = (await client.query('SELECT COUNT(*) AS samples, AVG(llm_agreement_rate) AS llm_agreement_rate, AVG(static_agreement_rate) AS static_agreement_rate FROM parse_comparisons')).rows[0];
      await client.query('ROLLBACK');
    } finally { client.release(); await pool.end(); }
  } else if (provider === 'firebase') {
    const db = getFirebaseDb();
    const flags = await db.collection('feature_flags').get();
    flags.docs.forEach(doc => deployed.set(doc.id, Boolean(doc.data().enabled)));
    artifactPaths = (await db.collection('blog_day_map_artifacts').get()).docs.map(doc => String(doc.data().gcsPath ?? doc.data().gcs_path ?? ''));
    // Comparison documents contain booking details: select only aggregate inputs.
    const comparisons = await db.collection('parse_comparisons').select('llmAgreementRate', 'staticAgreementRate').get();
    const average = (field: string): number | null => {
      const values = comparisons.docs.map(doc => Number(doc.data()[field])).filter(Number.isFinite);
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    };
    consensus = { samples: comparisons.size, llmAgreementRate: average('llmAgreementRate'), staticAgreementRate: average('staticAgreementRate') };
  } else if (provider) throw new Error('Choose --provider=postgres or --provider=firebase');
  const eligible = artifactPaths?.filter(value => /^blog-maps\/[a-zA-Z0-9_-]+\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{32}\.png$/.test(value)) ?? null;
  const report = {
    generatedAt: new Date().toISOString(), mode: provider || 'source-only',
    flags: Object.entries(seeds).map(([key, seed]) => ({ key, seedEnabled: seed.enabled,
      deployedEnabled: deployed.get(key) ?? null,
      references: sources.filter(source => source.source.includes(key)).map(source => source.file),
    })),
    mapArtifacts: {
      status: provider ? 'Database rows inventoried; verify bucket objects/provenance and reader migration before deletion.' : 'Deployment and bucket not inspected.',
      rows: artifactPaths?.length ?? null, confirmedPathPattern: 'blog-maps/<trip>/<YYYY-MM-DD>/<32-hex-hash>.png',
      dryRunOnly: true, candidateObjectPaths: eligible,
      unrecognizedPaths: artifactPaths?.filter(value => !eligible?.includes(value)) ?? null,
      readers: sources.filter(source => source.source.includes('blog_day_map_artifacts')).map(source => source.file),
    },
    consensus,
    scannerConfiguration: Object.fromEntries(['INGESTION_ENCRYPTION_SECRET', 'INGESTION_VIRUS_SCAN_URL', 'INGESTION_VIRUS_SCAN_AUTH_TOKEN', 'INGESTION_MAIL_RECEIPT_SCHEDULER_READY'].map(name => [name, Boolean(getEnvValue(name))])),
  };
  const output = arg('output');
  if (output) fs.writeFileSync(path.resolve(output), JSON.stringify(report, null, 2) + '\n');
  else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
};
main().catch(() => { process.stderr.write('P0 audit failed; verify target, permissions and schema. No deployment mutations were attempted.\n'); process.exitCode = 1; });
