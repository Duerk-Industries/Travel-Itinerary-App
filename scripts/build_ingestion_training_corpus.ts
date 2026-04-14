import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { execFileSync } from 'child_process';
import * as parserTrainingCorpusModule from '../server/src/services/parserTrainingCorpus';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  buildOssRawEmailExample,
  buildPublicMarkupExample,
  buildSyntheticExamples,
  extractJsonLdBlocks,
} = ((parserTrainingCorpusModule as any).default ?? parserTrainingCorpusModule) as typeof import('../server/src/services/parserTrainingCorpus');

type ParserTrainingExample = import('../server/src/services/parserTrainingCorpus').ParserTrainingExample;

const OUTPUT_DIR = path.resolve(__dirname, '../training_data/ingestion_email_corpus');
const CACHE_DIR = path.join(OUTPUT_DIR, 'cache');

type PublicSource = {
  itemType: 'flight' | 'hotel' | 'rail';
  title: string;
  provider: string;
  url: string;
};

const PUBLIC_SOURCES: PublicSource[] = [
  {
    itemType: 'flight',
    title: 'Gmail Flight Reservation Markup',
    provider: 'Google for Developers',
    url: 'https://developers.google.com/workspace/gmail/markup/reference/flight-reservation',
  },
  {
    itemType: 'hotel',
    title: 'Gmail Hotel Reservation Markup',
    provider: 'Google for Developers',
    url: 'https://developers.google.com/workspace/gmail/markup/reference/hotel-reservation',
  },
  {
    itemType: 'rail',
    title: 'Gmail Train Reservation Markup',
    provider: 'Google for Developers',
    url: 'https://developers.google.com/workspace/gmail/markup/reference/train-reservation',
  },
];

const REFERENCE_URLS = [
  'https://schema.org/FlightReservation',
  'https://schema.org/LodgingReservation',
  'https://schema.org/TrainReservation',
];

const OSS_RAW_ARCHIVES = [
  {
    title: 'Apache SpamAssassin easy_ham',
    provider: 'Apache SpamAssassin',
    url: 'https://spamassassin.apache.org/old/publiccorpus/20030228_easy_ham.tar.bz2',
    limit: 6,
    licenseHint: 'Public corpus from Apache SpamAssassin',
  },
  {
    title: 'Apache SpamAssassin hard_ham',
    provider: 'Apache SpamAssassin',
    url: 'https://spamassassin.apache.org/old/publiccorpus/20030228_hard_ham.tar.bz2',
    limit: 6,
    licenseHint: 'Public corpus from Apache SpamAssassin',
  },
];

const ensureDir = (dirPath: string) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const writeJson = (filePath: string, value: unknown) => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const writeJsonl = (filePath: string, rows: unknown[]) => {
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
};

const fetchHtml = async (url: string): Promise<string> => {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Travel-Itinerary-App/1.0 (ingestion training corpus builder)',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
};

const fetchBytes = async (url: string): Promise<Buffer> => {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Travel-Itinerary-App/1.0 (ingestion training corpus builder)',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

const ensureTarAvailable = () => {
  try {
    execFileSync('tar', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const listArchiveEntries = (archivePath: string): string[] => {
  const stdout = execFileSync('tar', ['-tjf', archivePath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.endsWith('/'));
};

const extractArchiveEntry = (archivePath: string, entryName: string): string =>
  execFileSync('tar', ['-xOjf', archivePath, entryName], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

const parseArgs = () => {
  const defaults = { flight: 12, hotel: 12, rail: 12, oss: 12 };
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--synthetic-(flight|hotel|rail)=(\d+)$/);
    if (match) {
      defaults[match[1] as keyof typeof defaults] = Number(match[2]);
      continue;
    }
    const ossMatch = arg.match(/^--oss=(\d+)$/);
    if (ossMatch) {
      defaults.oss = Number(ossMatch[1]);
    }
  }
  return defaults;
};

const main = async () => {
  ensureDir(OUTPUT_DIR);
  const harvestedAt = new Date().toISOString();
  const publicExamples: ParserTrainingExample[] = [];
  const ossRawExamples: ParserTrainingExample[] = [];
  const sourceSnapshots: Array<{ title: string; url: string; htmlPath: string; blockCount: number }> = [];

  for (const source of PUBLIC_SOURCES) {
    const html = await fetchHtml(source.url);
    const snapshotName = source.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const htmlPath = path.join(OUTPUT_DIR, `${snapshotName}.html`);
    fs.writeFileSync(htmlPath, html, 'utf8');

    const blocks = extractJsonLdBlocks(html);
    let added = 0;
    for (const block of blocks) {
      const example = buildPublicMarkupExample({
        itemType: source.itemType,
        title: source.title,
        provider: source.provider,
        url: source.url,
        harvestedAt,
        jsonLd: block,
      });
      if (!example) continue;
      publicExamples.push(example);
      added += 1;
    }

    sourceSnapshots.push({
      title: source.title,
      url: source.url,
      htmlPath,
      blockCount: added,
    });
  }

  const syntheticCounts = parseArgs();
  ensureDir(CACHE_DIR);
  const canUseTar = ensureTarAvailable();
  const perArchiveLimit = Math.max(1, Math.floor((syntheticCounts.oss || 0) / Math.max(OSS_RAW_ARCHIVES.length, 1)));

  if (canUseTar && syntheticCounts.oss > 0) {
    for (const archive of OSS_RAW_ARCHIVES) {
      const archiveName = path.basename(new URL(archive.url).pathname);
      const archivePath = path.join(CACHE_DIR, archiveName);
      if (!fs.existsSync(archivePath)) {
        fs.writeFileSync(archivePath, await fetchBytes(archive.url));
      }
      const entries = listArchiveEntries(archivePath)
        .filter((entry) => !/cmds$/i.test(entry))
        .slice(0, Math.min(archive.limit, perArchiveLimit));
      for (const entry of entries) {
        const rawEmail = extractArchiveEntry(archivePath, entry);
        ossRawExamples.push(
          buildOssRawEmailExample({
            rawEmail,
            title: `${archive.title}: ${path.basename(entry)}`,
            provider: archive.provider,
            url: `${archive.url}#${entry}`,
            harvestedAt,
            licenseHint: archive.licenseHint,
          })
        );
      }
    }
  }

  const syntheticExamples = buildSyntheticExamples(syntheticCounts);
  const combinedExamples = [...publicExamples, ...ossRawExamples, ...syntheticExamples];
  const trainExamples = combinedExamples.filter((row) => row.split === 'train');
  const validationExamples = combinedExamples.filter((row) => row.split === 'validation');

  writeJson(path.join(OUTPUT_DIR, 'manifest.json'), {
    generatedAt: harvestedAt,
    publicSources: PUBLIC_SOURCES,
    referenceUrls: REFERENCE_URLS,
    syntheticCounts,
    counts: {
      public: publicExamples.length,
      ossRaw: ossRawExamples.length,
      synthetic: syntheticExamples.length,
      combined: combinedExamples.length,
      train: trainExamples.length,
      validation: validationExamples.length,
    },
    snapshots: sourceSnapshots,
    ossRawArchives: OSS_RAW_ARCHIVES,
    tarAvailable: canUseTar,
  });

  writeJsonl(path.join(OUTPUT_DIR, 'public_examples.jsonl'), publicExamples);
  writeJsonl(path.join(OUTPUT_DIR, 'oss_raw_examples.jsonl'), ossRawExamples);
  writeJsonl(path.join(OUTPUT_DIR, 'synthetic_examples.jsonl'), syntheticExamples);
  writeJsonl(path.join(OUTPUT_DIR, 'combined_examples.jsonl'), combinedExamples);
  writeJsonl(path.join(OUTPUT_DIR, 'train_examples.jsonl'), trainExamples);
  writeJsonl(path.join(OUTPUT_DIR, 'validation_examples.jsonl'), validationExamples);

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'README.md'),
    [
      '# Ingestion Email Corpus',
      '',
      'Generated by `npm run ingestion:corpus:build`.',
      '',
      'Files:',
      '- `public_examples.jsonl`: examples harvested from official Gmail reservation markup docs.',
      '- `oss_raw_examples.jsonl`: curated public raw-email examples harvested from OSS/public corpora and labeled as `generic_note` noise examples.',
      '- `synthetic_examples.jsonl`: synthetic flight, hotel, and rail emails rendered into raw MIME emails with parser labels.',
      '- `combined_examples.jsonl`: public + synthetic examples.',
      '- `train_examples.jsonl`: deterministic training split.',
      '- `validation_examples.jsonl`: deterministic validation split.',
      '- `manifest.json`: source manifest and counts.',
      '',
      'Record schema:',
      '- `email.rawEmail`: full MIME email string.',
      '- `email.textBody` / `email.htmlBody`: rendered bodies.',
      '- `label.itemType` and `label.items`: parser-oriented supervision aligned with the extraction prompt fields.',
    ].join('\n'),
    'utf8',
  );

  console.log(`Wrote corpus to ${OUTPUT_DIR}`);
  console.log(`Public examples: ${publicExamples.length}`);
  console.log(`OSS raw-email examples: ${ossRawExamples.length}`);
  console.log(`Synthetic examples: ${syntheticExamples.length}`);
  console.log(`Train: ${trainExamples.length}`);
  console.log(`Validation: ${validationExamples.length}`);
};

main().catch((error) => {
  console.error('Failed to build ingestion training corpus:', error);
  process.exitCode = 1;
});
