// Test/SSR shim to satisfy Node/Jest resolution; real implementations live in platform files.
export const extractTextFromImage = async (_file: any): Promise<string> => '';
export const extractTextFromPdf = async (_file: any): Promise<string> => '';

export default {
  extractTextFromImage,
  extractTextFromPdf,
};
export * from './transferParsing.web';

