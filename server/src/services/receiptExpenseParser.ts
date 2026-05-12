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

const extractVendor = (lines: string[]): string | null => {
  const ignored = /^(receipt|invoice|tax invoice|sale|date|time|total|subtotal|amount|visa|mastercard|amex|cash)$/i;
  return lines.find((line) => line.length >= 2 && line.length <= 80 && !ignored.test(line)) ?? null;
};

const extractDate = (text: string): string | null => {
  const iso = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const us = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b/);
  if (!us) return null;
  const year = us[3].length === 2 ? `20${us[3]}` : us[3];
  return `${year}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
};

const extractCurrency = (text: string, fallbackCurrency?: string | null): string | null => {
  const symbol = Object.keys(currencyBySymbol).find((candidate) => text.includes(candidate));
  if (symbol) return currencyBySymbol[symbol];
  const code = text.match(/\b(USD|EUR|GBP|JPY|CAD|AUD|CHF|CNY|INR|MXN)\b/i)?.[1];
  return code ? code.toUpperCase() : fallbackCurrency ? fallbackCurrency.toUpperCase() : null;
};

const extractAmount = (lines: string[]): number | null => {
  const amountPattern = /([$€£¥]?\s*\d{1,4}(?:[,.]\d{3})*(?:[.,]\d{2}))/;
  const preferred = lines.filter((line) => /\b(total|amount due|balance due|grand total)\b/i.test(line) && !/\b(subtotal|tax|tip)\b/i.test(line));
  for (const line of [...preferred, ...lines.slice().reverse()]) {
    const match = line.match(amountPattern);
    if (!match) continue;
    const normalized = match[1].replace(/[$€£¥\s,]/g, '');
    const amount = Number(normalized);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
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
  const category = categorySuggestion?.category ?? 'Other';
  const confidenceParts = [vendor ? 0.2 : 0, date ? 0.2 : 0, amount ? 0.3 : 0, currency ? 0.1 : 0, categorySuggestion ? 0.2 : 0];
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
