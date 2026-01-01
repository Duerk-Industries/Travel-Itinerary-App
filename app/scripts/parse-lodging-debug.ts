import fs from 'fs';
import path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import { createWorker } from 'tesseract.js';
import { parseLodgingText } from '../utils/parsers/lodgingParser';

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

const main = async () => {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npm run parse:lodging -- <file.pdf|image>');
    process.exit(1);
  }

  const absPath = path.resolve(target);
  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  const lower = absPath.toLowerCase();
  const isPdf = lower.endsWith('.pdf');
  const isImage = /\.(png|jpe?g|webp|bmp|tiff?)$/.test(lower);

  if (!isPdf && !isImage) {
    console.error('Only PDF or common image formats are supported.');
    process.exit(1);
  }

  try {
    const text = isPdf ? await extractTextFromPdf(absPath) : await extractTextFromImage(absPath);
    const parsed = parseLodgingText(text);
    console.log(JSON.stringify(parsed, null, 2));
  } catch (err) {
    console.error('Failed to parse file:', err);
    process.exit(1);
  }
};

main();
