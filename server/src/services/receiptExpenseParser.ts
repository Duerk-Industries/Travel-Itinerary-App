import { extractImageTextViaOcr } from '../ingestion/normalization/ocr';
import { lookupMerchantCategory, type ExpenseCategory } from './merchantCategoryLookupService';

export type ParsedReceiptExpenseDraft = {
  expenseDate: string | null;
  amount: number | null;
  currency: string | null;
  vendor: string | null;
  category: ExpenseCategory;
  notes: string | null;
  confidence: number;
  rawSignals: {
    merchantCategorySource?: string | null;
    merchantCategory?: string | null;
  };
};

const currencyBySymbol: Record<string, string> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
};

const normalizeLine = (line: string): string => line.replace(/\s+/g, ' ').trim();

const normalizeMerchantName = (text: string): string | null => {
  if (/\bwhole\s*foods(?:\s*market)?\b/i.test(text)) return 'Whole Foods Market';
  if (/\btrader\s+joe'?s\b/i.test(text)) return "Trader Joe's";
  if (/\bcostco\b/i.test(text)) return 'Costco';
  if (/\btarget\b/i.test(text)) return 'Target';
  return null;
};

const extractVendor = (lines: string[]): string | null => {
  const known = normalizeMerchantName(lines.join('\n'));
  if (known) return known;
  const ignored = /^(receipt|invoice|tax invoice|sale|date|time|total|subtotal|amount|visa|mastercard|amex|cash|credit|debit)$/i;
  const noisy = /\b(?:http|www\.|\.com|membership|barcode|authorization|reference|approved|terminal|card|visa|mastercard|amex|subtotal|savings?|returns?)\b/i;
  return lines.find((line) => line.length >= 2 && line.length <= 80 && !ignored.test(line) && !noisy.test(line)) ?? null;
};

const extractDate = (text: string): string | null => {
  const iso = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const matches = Array.from(text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b/g));
  for (const us of matches) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
};

const extractCurrency = (text: string, fallbackCurrency?: string | null): string | null => {
  const symbol = Object.keys(currencyBySymbol).find((candidate) => text.includes(candidate));
  if (symbol) return currencyBySymbol[symbol];
  const code = text.match(/\b(USD|EUR|GBP|JPY|CAD|AUD|CHF|CNY|INR|MXN)\b/i)?.[1];
  return code ? code.toUpperCase() : fallbackCurrency ? fallbackCurrency.toUpperCase() : null;
};

const extractAmount = (lines: string[]): number | null => {
  const amountPattern = /([$€£¥]?\s*\d{1,4}(?:[,.]\d{3})*(?:[.,]\d{2}))/g;
  const excluded = /\b(subtotal|tax|tip|savings?|discount|coupon|change|cash\s*back|cashback|return|refund)\b/i;
  const parseAmounts = (line: string): number[] =>
    Array.from(line.matchAll(amountPattern))
      .map((match) => Number(match[1].replace(/[$€£¥\s,]/g, '')))
      .filter((amount) => Number.isFinite(amount) && amount > 0);

  const preferred = lines.filter(
    (line) => /\b(grand total|balance due|amount due|total|net sales)\b/i.test(line) && !excluded.test(line)
  );
  for (const line of preferred) {
    const amounts = parseAmounts(line);
    if (amounts.length) return amounts[amounts.length - 1];
  }

  const paid = lines.filter((line) => /\b(paid|visa|mastercard|amex|credit|debit)\b/i.test(line) && !excluded.test(line));
  for (const line of paid) {
    const amounts = parseAmounts(line);
    if (amounts.length) return amounts[amounts.length - 1];
  }

  const fallback = lines.filter((line) => !excluded.test(line)).flatMap(parseAmounts);
  return fallback.length ? Math.max(...fallback) : null;
};

const inferReceiptCategory = (vendor: string | null, text: string): ExpenseCategory | null => {
  const haystack = `${vendor ?? ''}\n${text}`;
  if (/\b(whole foods|supermarket|grocery|grocer|market|trader joe'?s)\b/i.test(haystack)) return 'Other Food';
  if (/\b(cafe|coffee|bakery)\b/i.test(haystack)) return 'Breakfast';
  if (/\b(taxi|uber|lyft|parking|fuel|gas station)\b/i.test(haystack)) return 'Rides';
  return null;
};

export const parseReceiptText = async (
  text: string,
  options: { fallbackCurrency?: string | null; destination?: string | null } = {}
): Promise<ParsedReceiptExpenseDraft> => {
  const lines = text.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const vendor = extractVendor(lines);
  const date = extractDate(text);
  const amount = extractAmount(lines);
  const currency = extractCurrency(text, options.fallbackCurrency);
  const categorySuggestion = vendor ? await lookupMerchantCategory({ vendor, destination: options.destination }) : null;
  const inferredCategory = inferReceiptCategory(vendor, text);
  const category = categorySuggestion?.category ?? inferredCategory ?? 'Other';
  const confidenceParts = [vendor ? 0.2 : 0, date ? 0.2 : 0, amount ? 0.3 : 0, currency ? 0.1 : 0, categorySuggestion || inferredCategory ? 0.2 : 0];
  const confidence = Math.min(0.95, confidenceParts.reduce((sum, value) => sum + value, 0));
  return {
    expenseDate: date,
    amount,
    currency,
    vendor,
    category,
    notes: 'Parsed from receipt photo. Review before saving.',
    confidence,
    rawSignals: {
      merchantCategorySource: categorySuggestion?.provider ?? null,
      merchantCategory: categorySuggestion?.providerType ?? categorySuggestion?.providerCategory ?? null,
    },
  };
};

export const parseReceiptImage = async (
  bytes: Buffer,
  mimeType: string,
  options: { fallbackCurrency?: string | null; destination?: string | null } = {}
): Promise<ParsedReceiptExpenseDraft> => {
  const text = await extractImageTextViaOcr(bytes, mimeType);
  return parseReceiptText(text, options);
};
