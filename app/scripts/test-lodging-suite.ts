import fs from 'fs';
import path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import { createWorker } from 'tesseract.js';
import { parseLodgingText } from '../utils/lodgingParser';

const resolvePdfWorker = () => {
  const pdfMain = require.resolve('pdfjs-dist/legacy/build/pdf.js');
  const workerPath = path.join(path.dirname(pdfMain), 'pdf.worker.min.js');
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc = workerPath;
};

const extractTextFromPdf = async (filePath: string): Promise<string> => {
  resolvePdfWorker();
  const data = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = (pdfjsLib as any).getDocument({ data });
  const pdf = await loadingTask.promise;
  let combined = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    combined += content.items.map((item: any) => item.str).join(' ') + '\n';
  }
  return combined;
};

const extractTextFromImage = async (filePath: string): Promise<string> => {
  const worker = await createWorker('eng');
  try {
    const { data } = await worker.recognize(filePath);
    return data.text ?? '';
  } finally {
    await worker.terminate();
  }
};

const compare = (parsed: any, expected: any): string[] => {
  const diffs: string[] = [];
  for (const key of Object.keys(expected)) {
    const p = parsed[key];
    const e = expected[key];
    if (String(p ?? '') !== String(e ?? '')) {
      diffs.push(`${key}: expected "${e}", got "${p}"`);
    }
  }
  return diffs;
};

const main = async () => {
  const roots = [path.join(__dirname, '../../test_inputs/lodging')].filter((p) => fs.existsSync(p));
  if (!roots.length) {
    console.error('No lodging fixtures found.');
    process.exit(1);
  }

  const targets = roots
    .flatMap((root) => fs.readdirSync(root).map((f) => ({ root, file: f })))
    .filter(({ file }) => /\.(pdf|png|jpe?g|webp|bmp|tiff?)$/i.test(file));
  if (!targets.length) {
    console.error('No lodging fixtures found.');
    process.exit(1);
  }

  let hadError = false;

  for (const { root, file } of targets) {
    const base = file.replace(/\.(pdf|png|jpe?g|webp|bmp|tiff?)$/i, '');
    const jsonPath =
      fs.existsSync(path.join(root, `${base}.json`))
        ? path.join(root, `${base}.json`)
        : roots.map((r) => path.join(r, `${base}.json`)).find((p) => fs.existsSync(p)) ?? null;
    if (!jsonPath) {
      console.error(`Missing expected JSON for ${file}`);
      hadError = true;
      continue;
    }
    const expected = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const fullPath = path.join(root, file);
    const isPdf = file.toLowerCase().endsWith('.pdf');
    const text = isPdf ? await extractTextFromPdf(fullPath) : await extractTextFromImage(fullPath);
    const parsed = parseLodgingText(text);
    const diffs = compare(parsed, expected);
    if (diffs.length) {
      hadError = true;
      console.error(`FAIL ${file}:`);
      diffs.forEach((d) => console.error(`  ${d}`));
    } else {
      console.log(`PASS ${file}`);
    }
  }

  if (hadError) process.exit(1);
};

main();
