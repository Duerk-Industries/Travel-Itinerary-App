import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { execFileSync } from 'child_process';
import * as parserTrainingCorpusModule from '../server/src/services/parserTrainingCorpus';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  buildCuratedOpenTravelExample,
  buildOssRawEmailExample,
  buildWeakTravelMiningExample,
  buildPublicMarkupExample,
  buildSyntheticExamples,
  extractWeakTravelMiningTextsFromHtml,
  extractJsonLdBlocks,
  parseFlightSummaryHtml,
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

const CURATED_TRAVEL_SOURCES = [
  {
    title: 'flight-reservation-emails summary',
    provider: 'JohannesBuchner/flight-reservation-emails',
    url: 'https://raw.githubusercontent.com/JohannesBuchner/flight-reservation-emails/master/summary.html',
    limit: 12,
    licenseHint: 'Open-source curated travel summary fixture',
  },
];

const REFERENCE_URLS = [
  'https://schema.org/FlightReservation',
  'https://schema.org/LodgingReservation',
  'https://schema.org/TrainReservation',
];

const WEAK_TRAVEL_WEB_SOURCES = [
  ...PUBLIC_SOURCES.map((source) => ({
    title: source.title,
    provider: source.provider,
    url: source.url,
    limit: 3,
    licenseHint: 'Public travel reservation documentation snippet',
  })),
  {
    title: 'Schema.org FlightReservation',
    provider: 'Schema.org',
    url: 'https://schema.org/FlightReservation',
    limit: 2,
    licenseHint: 'Public travel reservation schema reference',
  },
  {
    title: 'Schema.org LodgingReservation',
    provider: 'Schema.org',
    url: 'https://schema.org/LodgingReservation',
    limit: 2,
    licenseHint: 'Public travel reservation schema reference',
  },
  {
    title: 'Schema.org TrainReservation',
    provider: 'Schema.org',
    url: 'https://schema.org/TrainReservation',
    limit: 2,
    licenseHint: 'Public travel reservation schema reference',
  },
  {
    title: 'flight-reservation-emails summary',
    provider: 'JohannesBuchner/flight-reservation-emails',
    url: 'https://raw.githubusercontent.com/JohannesBuchner/flight-reservation-emails/master/summary.html',
    limit: 6,
    licenseHint: 'Open-source curated travel summary fixture',
  },
];

const OSS_RAW_ARCHIVES = [
  {
    title: 'Apache SpamAssassin easy_ham',
    provider: 'Apache SpamAssassin',
    url: 'https://spamassassin.apache.org/old/publiccorpus/20030228_easy_ham.tar.bz2',
    limit: 6,
    licenseHint: 'Public corpus from Apache SpamAssassin',
    weakMine: false,
  },
  {
    title: 'Apache SpamAssassin hard_ham',
    provider: 'Apache SpamAssassin',
    url: 'https://spamassassin.apache.org/old/publiccorpus/20030228_hard_ham.tar.bz2',
    limit: 6,
    licenseHint: 'Public corpus from Apache SpamAssassin',
    weakMine: false,
  },
  {
    title: 'Apache SpamAssassin spam_2',
    provider: 'Apache SpamAssassin',
    url: 'https://spamassassin.apache.org/old/publiccorpus/20050311_spam_2.tar.bz2',
    limit: 12,
    licenseHint: 'Public corpus from Apache SpamAssassin',
    weakMine: true,
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
  const defaults = { flight: 12, hotel: 12, rail: 12, oss: 12, curated: 12, weak: 8 };
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--synthetic-(flight|hotel|rail)=(\d+)$/);
    if (match) {
      defaults[match[1] as keyof typeof defaults] = Number(match[2]);
      continue;
    }
    const ossMatch = arg.match(/^--oss=(\d+)$/);
    if (ossMatch) {
      defaults.oss = Number(ossMatch[1]);
      continue;
    }
    const curatedMatch = arg.match(/^--curated=(\d+)$/);
    if (curatedMatch) {
      defaults.curated = Number(curatedMatch[1]);
      continue;
    }
    const weakMatch = arg.match(/^--weak=(\d+)$/);
    if (weakMatch) {
      defaults.weak = Number(weakMatch[1]);
    }
  }
  return defaults;
};

const main = async () => {
  ensureDir(OUTPUT_DIR);
  const harvestedAt = new Date().toISOString();
  const publicExamples: ParserTrainingExample[] = [];
  const curatedTravelExamples: ParserTrainingExample[] = [];
  const ossRawExamples: ParserTrainingExample[] = [];
  const weakTravelExamples: ParserTrainingExample[] = [];
  const sourceSnapshots: Array<{ title: string; url: string; htmlPath: string; blockCount: number }> = [];
  const weakTravelSnapshots: Array<{ title: string; url: string; snippetCount: number; exampleCount: number }> = [];

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
  for (const source of CURATED_TRAVEL_SOURCES) {
    if (syntheticCounts.curated <= 0) break;
    const html = await fetchHtml(source.url);
    const rows = parseFlightSummaryHtml(html).slice(0, Math.min(source.limit, syntheticCounts.curated));
    for (const row of rows) {
      curatedTravelExamples.push(
        buildCuratedOpenTravelExample({
          title: source.title,
          provider: source.provider,
          url: source.url,
          harvestedAt,
          ...row,
        })
      );
    }
  }
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

  if (syntheticCounts.weak > 0) {
    for (const source of WEAK_TRAVEL_WEB_SOURCES) {
      if (weakTravelExamples.length >= syntheticCounts.weak) break;

      const html = await fetchHtml(source.url);
      const snippets = extractWeakTravelMiningTextsFromHtml(html).slice(0, source.limit);
      let exampleCount = 0;

      for (const [index, snippet] of snippets.entries()) {
        if (weakTravelExamples.length >= syntheticCounts.weak) break;

        // Wrap public travel snippets as simple raw emails so the weak miner exercises the same path as real messages.
        const rawEmail = [
          `From: weak-mined-${index + 1}@example.com`,
          'To: traveler@example.com',
          `Subject: ${source.title}`,
          'Content-Type: text/plain; charset=UTF-8',
          '',
          snippet,
        ].join('\n');

        const example = buildWeakTravelMiningExample({
          rawEmail,
          title: `${source.title} snippet ${index + 1}`,
          provider: source.provider,
          url: `${source.url}#snippet-${index + 1}`,
          harvestedAt,
          licenseHint: source.licenseHint,
        });

        if (example) {
          weakTravelExamples.push(example);
          exampleCount += 1;
        }
      }

      weakTravelSnapshots.push({
        title: source.title,
        url: source.url,
        snippetCount: snippets.length,
        exampleCount,
      });
    }
  }

  const syntheticExamples = buildSyntheticExamples(syntheticCounts);
  const combinedExamples = [...publicExamples, ...curatedTravelExamples, ...weakTravelExamples, ...ossRawExamples, ...syntheticExamples];
  const trainExamples = combinedExamples.filter((row) => row.split === 'train');
  const validationExamples = combinedExamples.filter((row) => row.split === 'validation');

  writeJson(path.join(OUTPUT_DIR, 'manifest.json'), {
    generatedAt: harvestedAt,
    publicSources: PUBLIC_SOURCES,
    referenceUrls: REFERENCE_URLS,
    syntheticCounts,
    counts: {
      public: publicExamples.length,
      curatedTravel: curatedTravelExamples.length,
      weakTravel: weakTravelExamples.length,
      ossRaw: ossRawExamples.length,
      synthetic: syntheticExamples.length,
      combined: combinedExamples.length,
      train: trainExamples.length,
      validation: validationExamples.length,
    },
    snapshots: sourceSnapshots,
    weakTravelSources: WEAK_TRAVEL_WEB_SOURCES,
    weakTravelSnapshots,
    ossRawArchives: OSS_RAW_ARCHIVES,
    tarAvailable: canUseTar,
  });

  writeJsonl(path.join(OUTPUT_DIR, 'public_examples.jsonl'), publicExamples);
  writeJsonl(path.join(OUTPUT_DIR, 'curated_travel_examples.jsonl'), curatedTravelExamples);
  writeJsonl(path.join(OUTPUT_DIR, 'weak_travel_examples.jsonl'), weakTravelExamples);
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
      '- `curated_travel_examples.jsonl`: curated open travel-specific fixtures harvested from open-source travel parser example material.',
      '- `weak_travel_examples.jsonl`: weakly supervised travel emails mined from travel-focused public web sources using stricter travel heuristics.',
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
  console.log(`Curated travel examples: ${curatedTravelExamples.length}`);
  console.log(`Weak travel examples: ${weakTravelExamples.length}`);
  console.log(`OSS raw-email examples: ${ossRawExamples.length}`);
  console.log(`Synthetic examples: ${syntheticExamples.length}`);
  console.log(`Train: ${trainExamples.length}`);
  console.log(`Validation: ${validationExamples.length}`);
};

main().catch((error) => {
  console.error('Failed to build ingestion training corpus:', error);
  process.exitCode = 1;
});
