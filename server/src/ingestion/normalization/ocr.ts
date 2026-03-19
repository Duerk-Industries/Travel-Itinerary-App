import { createWorker, type Worker } from 'tesseract.js';
import { logError, logInfo } from '../../logger';

let workerPromise: Promise<Worker> | null = null;

const getWorker = async (): Promise<Worker> => {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng');
      logInfo('[ingestion][ocr] initialized tesseract worker language=eng');
      return worker;
    })();
  }
  return workerPromise;
};

export const extractImageTextViaOcr = async (bytes: Buffer, mimeType: string): Promise<string> => {
  const worker = await getWorker();
  try {
    const result = await worker.recognize(bytes);
    return String(result?.data?.text ?? '').trim();
  } catch (error) {
    logError(`[ingestion][ocr] recognition failed mime=${mimeType}`, error);
    throw error;
  }
};
