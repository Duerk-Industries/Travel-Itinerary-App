export const extractTextFromPdf = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  // Use the legacy ES build to avoid Metro/Hermes bundle issues on native targets.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  (pdfjs as any).GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${(pdfjs as any).version}/pdf.worker.min.js`;
  const loadingTask = (pdfjs as any).getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  let combined = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    combined += content.items.map((item: any) => item.str).join(' ') + '\n';
  }
  return combined;
};

export const extractTextFromImage = async (file: File): Promise<string> => {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  const url = URL.createObjectURL(file);
  try {
    const { data } = await worker.recognize(url);
    return data.text ?? '';
  } finally {
    URL.revokeObjectURL(url);
    await worker.terminate();
  }
};
