import { createWorker, PSM, type Worker } from 'tesseract.js';
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
    const recognize = async (mode: PSM): Promise<string> => {
      await worker.setParameters({ tessedit_pageseg_mode: mode });
      const result = await worker.recognize(bytes, { rotateAuto: true });
      return String(result?.data?.text ?? '').trim();
    };
    const primary = await recognize(PSM.AUTO);
    if (primary.replace(/\s/g, '').length >= 80) return primary;

    // Sparse text is slower, so keep it as a fallback for photos where the
    // receipt is skewed, rotated, or surrounded by a lot of table/background.
    const sparse = await recognize(PSM.SPARSE_TEXT);
    return sparse.replace(/\s/g, '').length > primary.replace(/\s/g, '').length ? sparse : primary;
  } catch (error) {
    logError(`[ingestion][ocr] recognition failed mime=${mimeType}`, error);
    throw error;
  }
};
