import { extractImageTextViaOcr } from '../ingestion/normalization/ocr';
import { lookupMerchantCategory, type ExpenseCategory } from './merchantCategoryLookupService';

/** What kind of place issued the receipt -- drives the category (and, for food service, the meal). */
export type EstablishmentType = 'cafe' | 'restaurant' | 'bar' | 'fast_food' | 'grocery' | 'transport' | 'shop';

export type ParsedReceiptExpenseDraft = {
  expenseDate: string | null;
  /** 24-hour "HH:MM" printed on the receipt, if any. */
  expenseTime: string | null;
  amount: number | null;
  currency: string | null;
  /** Cleaned-up merchant name; this is what goes into the expense's Description field. */
  vendor: string | null;
  category: ExpenseCategory;
  establishmentType: EstablishmentType | null;
  /** Always null: review guidance is shown by the client, never written into the expense. */
  notes: string | null;
  confidence: number;
  rawSignals: {
    merchantCategorySource?: string | null;
    merchantCategory?: string | null;
  };
};

export type ReceiptParseOptions = {
  fallbackCurrency?: string | null;
  destination?: string | null;
  /** Trip range ("YYYY-MM-DD"), used to resolve day/month order on dates like 05.09.2026. */
  tripStartDate?: string | null;
  tripEndDate?: string | null;
};

const normalizeLine = (line: string): string => line.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------------
// Vendor
// ---------------------------------------------------------------------------------------------

const KNOWN_MERCHANTS: Array<[RegExp, string]> = [
  [/\bwhole\s*foods(?:\s*market)?\b/i, 'Whole Foods Market'],
  [/\btrader\s+joe'?s\b/i, "Trader Joe's"],
  [/\bcostco\b/i, 'Costco'],
  [/\btarget\b/i, 'Target'],
];

// Lines that are never the merchant name: greetings, receipt titles, payment and tax-id lines.
const NOT_A_NAME = /^(?:receipt|invoice|tax invoice|sale|sales receipt|bon fiscal|factura|fattura|rechnung|quittung|ticket|recu|reçu|date|time|total|subtotal|amount|visa|mastercard|amex|cash|credit|debit|copy|customer copy|merchant copy)$/i;
const GREETING = /\b(?:welcome|thank you|thanks|bine a[țt]i venit|willkommen|bienvenue|bienvenido|benvenuti|have a nice day)\b/i;
const NOISE = /\b(?:http|www\.|\.com|membership|barcode|authori[sz]ation|reference|approved|terminal|card|visa|mastercard|amex|subtotal|savings?|returns?|tel|phone|fax|vat|tva|iva|mwst|cui|cif|nif|ein|tax id|order|table|tbl|server|cashier|guest)\b/i;
const STREET = /\b(?:st|street|str|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|way|plaza|calea|strada|bd|bulevardul|via|rue|platz|stra[sß]e|calle|suite|ste)\b\.?/i;
const DATE_OR_TIME = /\b\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}\b|\b\d{1,2}:\d{2}\b/;

const looksLikeAddressOrNumber = (line: string): boolean => {
  const letters = (line.match(/\p{L}/gu) || []).length;
  const digits = (line.match(/\d/g) || []).length;
  if (letters < 2) return true; // logo noise, separators, bare numbers
  if (digits > letters) return true; // phone numbers, ids, postcodes
  return /\d/.test(line) && STREET.test(line); // "123 Market St", "Str. Stavropoleos 5"
};

/** OCR text is often ALL CAPS; "JOE'S PIZZA" reads better as "Joe's Pizza". Mixed case is kept. */
export const tidyVendorName = (name: string): string => {
  const trimmed = name.replace(/^[^\p{L}\d]+|[^\p{L}\d)'’.!&]+$/gu, '').trim();
  if (trimmed !== trimmed.toUpperCase()) return trimmed;
  return trimmed.toLowerCase().replace(/(^|[\s\-/&(])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
};

const extractVendor = (lines: string[]): string | null => {
  const joined = lines.join('\n');
  for (const [pattern, name] of KNOWN_MERCHANTS) if (pattern.test(joined)) return name;
  // The merchant name is near the top; never pick it from line items further down.
  const candidate = lines.slice(0, 8).find((line) =>
    line.length >= 2 && line.length <= 60
    && !NOT_A_NAME.test(line) && !GREETING.test(line) && !NOISE.test(line)
    && !DATE_OR_TIME.test(line) && !looksLikeAddressOrNumber(line));
  return candidate ? tidyVendorName(candidate) : null;
};

// ---------------------------------------------------------------------------------------------
// Date and time
// ---------------------------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  // A few non-English abbreviations seen on European receipts.
  ian: 1, mai: 5, iun: 6, iul: 7, okt: 10, dez: 12, ene: 1, abr: 4, ago: 8, dic: 12, gen: 1, giu: 6, lug: 7, set: 9, ott: 10, janv: 1, fevr: 2, avr: 4, juil: 7,
};

const pad = (value: number): string => String(value).padStart(2, '0');
const isoDate = (year: number, month: number, day: number): string | null => {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null; // e.g. Feb 30
  return `${year}-${pad(month)}-${pad(day)}`;
};
const fullYear = (raw: string): number => (raw.length === 2 ? 2000 + Number(raw) : Number(raw));

// Countries that write the month first. Everyone else (most of the world) writes the day first.
const MONTH_FIRST_CURRENCIES = new Set(['USD']);

const inRange = (date: string, start?: string | null, end?: string | null): boolean =>
  Boolean(start && end && date >= start && date <= end);

export const extractDate = (text: string, options: ReceiptParseOptions & { currency?: string | null } = {}): string | null => {
  const iso = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) {
    const value = isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (value) return value;
  }

  // "5 Sep 2026", "05-Sep-26", "Sep 5, 2026"
  const dayMonthName = text.match(/\b(\d{1,2})[\s\-./]*([A-Za-zăâîșțé]{3,5})\.?[\s\-./,]*(20\d{2}|\d{2})\b/);
  const monthNameDay = text.match(/\b([A-Za-z]{3,5})\.?\s+(\d{1,2}),?\s+(20\d{2})\b/);
  for (const [dayRaw, monthRaw, yearRaw] of [
    dayMonthName ? [dayMonthName[1], dayMonthName[2], dayMonthName[3]] : null,
    monthNameDay ? [monthNameDay[2], monthNameDay[1], monthNameDay[3]] : null,
  ].filter(Boolean) as string[][]) {
    const month = MONTHS[monthRaw.toLowerCase().slice(0, 5)] ?? MONTHS[monthRaw.toLowerCase().slice(0, 4)] ?? MONTHS[monthRaw.toLowerCase().slice(0, 3)];
    if (!month) continue;
    const value = isoDate(fullYear(yearRaw), month, Number(dayRaw));
    if (value) return value;
  }

  // Numeric "05.09.2026" / "09/05/26": both readings may be valid. Pick the one inside the trip;
  // otherwise use the receipt's likely convention (month-first for USD, day-first elsewhere).
  const monthFirst = MONTH_FIRST_CURRENCIES.has(String(options.currency ?? options.fallbackCurrency ?? 'USD').toUpperCase());
  let fallback: string | null = null;
  for (const match of text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b/g)) {
    const year = fullYear(match[3]);
    const a = Number(match[1]);
    const b = Number(match[2]);
    const mdy = isoDate(year, a, b);
    const dmy = isoDate(year, b, a);
    const tripMatch = [mdy, dmy].find((value) => value && inRange(value, options.tripStartDate, options.tripEndDate));
    if (tripMatch) return tripMatch;
    fallback ??= (monthFirst ? mdy ?? dmy : dmy ?? mdy);
  }
  return fallback;
};

/** "20:41", "7:42 PM", "07.42 pm" -> "HH:MM" (24h). Prefers a time next to a date or a time label. */
export const extractTime = (text: string): string | null => {
  const pattern = /\b(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([ap])\.?\s?m\b\.?|\b(\d{1,2}):(\d{2})(?::\d{2})?\b/gi;
  const candidates: Array<{ value: string; score: number }> = [];
  for (const match of text.matchAll(pattern)) {
    const meridiem = match[3]?.toLowerCase();
    let hours = Number(match[1] ?? match[4]);
    const minutes = Number(match[2] ?? match[5]);
    if (minutes > 59) continue;
    if (meridiem) {
      if (hours < 1 || hours > 12) continue;
      if (meridiem === 'p' && hours !== 12) hours += 12;
      if (meridiem === 'a' && hours === 12) hours = 0;
    } else if (hours > 23) continue;
    const start = match.index ?? 0;
    const context = text.slice(Math.max(0, start - 24), start).toLowerCase();
    const line = text.slice(text.lastIndexOf('\n', start) + 1, (text.indexOf('\n', start) + 1 || text.length + 1) - 1);
    const score = (meridiem ? 2 : 0)
      + (/\b(time|ora|hora|heure|zeit|uhrzeit|orario)\b/.test(context) ? 3 : 0)
      + (DATE_OR_TIME.test(line.replace(match[0], '')) ? 2 : 0);
    candidates.push({ value: `${pad(hours)}:${pad(minutes)}`, score });
  }
  if (!candidates.length) return null;
  return candidates.reduce((best, candidate) => (candidate.score > best.score ? candidate : best)).value;
};

// ---------------------------------------------------------------------------------------------
// Amount and currency
// ---------------------------------------------------------------------------------------------

// Money with exactly two decimals, in either convention: 1,234.56 / 1.234,56 / 1 234,56 / 45,50.
const MONEY = /(?<![\d.,])(\d{1,3}(?:[ .,'’]\d{3})+|\d+)([.,])(\d{2})(?![\d])/g;

/** Parses a money token, treating the last separator as the decimal point. */
export const parseMoney = (raw: string): number | null => {
  const match = raw.match(/(\d{1,3}(?:[ .,'’]\d{3})+|\d+)[.,](\d{2})(?!\d)/);
  if (!match) return null;
  const value = Number(`${match[1].replace(/[ .,'’]/g, '')}.${match[2]}`);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const amountsIn = (line: string): number[] =>
  Array.from(line.matchAll(MONEY)).map((match) => parseMoney(match[0])).filter((value): value is number => value !== null);

const TOTAL_LINE = /\b(grand total|balance due|amount due|total|net sales|totale?|totaal|summe|gesamt(?:betrag)?|importe|importo|montant|suma|de plat[ăa])\b/i;
const NOT_TOTAL = /\b(subtotal|sub-total|sous-total|zwischensumme|tax|tva|vat|iva|mwst|tip|gratuity|savings?|discount|coupon|change|rest|cash\s*back|cashback|return|refund|points?)\b/i;
const TAX_INCLUDED = /\b(incl\.?|including|inkl\.?|incl[uú]s)\b/i;
const PAID_LINE = /\b(paid|visa|mastercard|amex|credit|debit|card|card payment|plata card|carte)\b/i;

const extractAmount = (lines: string[]): number | null => {
  const isExcluded = (line: string) => NOT_TOTAL.test(line) && !(TAX_INCLUDED.test(line) && TOTAL_LINE.test(line));
  for (const line of lines.filter((l) => TOTAL_LINE.test(l) && !isExcluded(l))) {
    const amounts = amountsIn(line);
    if (amounts.length) return amounts[amounts.length - 1];
  }
  for (const line of lines.filter((l) => PAID_LINE.test(l) && !isExcluded(l))) {
    const amounts = amountsIn(line);
    if (amounts.length) return amounts[amounts.length - 1];
  }
  const fallback = lines.filter((l) => !isExcluded(l)).flatMap(amountsIn);
  return fallback.length ? Math.max(...fallback) : null;
};

const CURRENCY_CODES = /\b(USD|EUR|GBP|JPY|CNY|RMB|CAD|AUD|NZD|CHF|INR|MXN|RON|PLN|CZK|HUF|SEK|NOK|DKK|ISK|TRY|THB|KRW|SGD|HKD|BRL|ZAR|AED|ILS|BGN|RSD|MAD|EGP|VND|IDR|MYR|PHP|TWD)\b/; // upper case only: "Server: Ron" is a name, not lei
const CURRENCY_WORDS: Array<[RegExp, string]> = [
  [/\blei\b/i, 'RON'],
  [/zł/i, 'PLN'],
  [/Kč/, 'CZK'],
  [/\d\s?Ft\b/, 'HUF'],
  [/лв|\bleva\b/i, 'BGN'],
  [/R\$/, 'BRL'],
  [/€/, 'EUR'],
  [/£/, 'GBP'],
  [/₹/, 'INR'],
  [/₩/, 'KRW'],
  [/฿/, 'THB'],
  [/₺/, 'TRY'],
  [/₪/, 'ILS'],
  [/₫/, 'VND'],
];
const DOLLAR_CURRENCIES = new Set(['USD', 'CAD', 'AUD', 'NZD', 'MXN', 'SGD', 'HKD', 'TWD']);
const YEN_CURRENCIES = new Set(['JPY', 'CNY']);
const KRONA_CURRENCIES = new Set(['SEK', 'NOK', 'DKK', 'ISK']);

export const extractCurrency = (text: string, fallbackCurrency?: string | null): string | null => {
  const fallback = fallbackCurrency ? fallbackCurrency.toUpperCase() : null;
  const code = text.match(CURRENCY_CODES)?.[1]?.toUpperCase();
  if (code) return code === 'RMB' ? 'CNY' : code;
  for (const [pattern, currency] of CURRENCY_WORDS) if (pattern.test(text)) return currency;
  // Ambiguous symbols: trust the trip's currency when it is one of the possible meanings.
  if (text.includes('$')) return fallback && DOLLAR_CURRENCIES.has(fallback) ? fallback : 'USD';
  if (text.includes('¥') || text.includes('円') || text.includes('元')) return fallback && YEN_CURRENCIES.has(fallback) ? fallback : 'JPY';
  if (/\bkr\.?\b/i.test(text)) return fallback && KRONA_CURRENCIES.has(fallback) ? fallback : 'SEK';
  return fallback;
};

// ---------------------------------------------------------------------------------------------
// Establishment and category
// ---------------------------------------------------------------------------------------------

// Matched against the vendor name and the receipt header only -- never line items or the address,
// so "123 Market St" or a "coffee" line on a dinner bill don't change the category.
const ESTABLISHMENT_KEYWORDS: Array<[RegExp, EstablishmentType]> = [
  [/\b(supermarket|super market|grocery|grocer|groceries|market|mart|minimarket|carrefour|lidl|aldi|kaufland|mega image|profi|penny|tesco|spar|whole foods|trader joe'?s|costco|walmart)\b/i, 'grocery'],
  [/\b(cafe|caf[eé]|coffee|espresso|bakery|boulangerie|patisserie|p[aâ]tisserie|cofet[aă]rie|brut[aă]rie|starbucks|tea house|teahouse)\b/i, 'cafe'],
  [/\b(mcdonald'?s|burger king|kfc|subway|domino'?s|taco bell|wendy'?s|five guys|fast food|takeaway|take away|kebab|shawarma|gyros?)\b/i, 'fast_food'],
  [/\b(bar|pub|tavern|brewery|beer|bere|berărie|taproom|wine bar|cocktail|lounge)\b/i, 'bar'],
  [/\b(restaurant|restaurante|ristorante|restaurang|bistro|brasserie|trattoria|osteria|pizzeria|pizza|grill|steakhouse|diner|sushi|ramen|noodle|taverna|tavern[aă]|cantina|kitchen|eatery|izakaya|bbq|curry|thai|dim sum|cucina)\b/i, 'restaurant'],
  [/\b(taxi|uber|lyft|bolt|parking|fuel|petrol|gas station|benzin|metro|railway|train|bus)\b/i, 'transport'],
  [/\b(souvenir|gift shop|gifts|museum shop|duty free)\b/i, 'shop'],
];

const establishmentFromProvider = (providerCategory?: string | null, providerType?: string | null): EstablishmentType | null => {
  const text = `${providerCategory ?? ''} ${providerType ?? ''}`.toLowerCase();
  if (/\b(cafe|coffee|bakery|pastry|confectionery)\b/.test(text)) return 'cafe';
  if (/\b(fast_food|food_court)\b/.test(text)) return 'fast_food';
  if (/\b(bar|pub|biergarten|nightclub)\b/.test(text)) return 'bar';
  if (/\b(restaurant|deli|ice_cream)\b/.test(text)) return 'restaurant';
  if (/\b(supermarket|convenience|grocery|greengrocer|marketplace)\b/.test(text)) return 'grocery';
  if (/\b(fuel|taxi|car_rental|parking|transport|bus_station|train_station)\b/.test(text)) return 'transport';
  if (/\b(souvenir|gift|mall|department_store)\b/.test(text)) return 'shop';
  return null;
};

const establishmentFromText = (vendor: string | null, headerLines: string[]): EstablishmentType | null => {
  const haystack = [vendor ?? '', ...headerLines].join('\n');
  for (const [pattern, type] of ESTABLISHMENT_KEYWORDS) if (pattern.test(haystack)) return type;
  return null;
};

const FOOD_SERVICE = new Set<EstablishmentType>(['cafe', 'restaurant', 'bar', 'fast_food']);

/**
 * Meal from the receipt time: before 10:30 is breakfast, 10:30-15:30 lunch, later (or before 04:00,
 * i.e. a late night out) dinner.
 */
export const mealForTime = (time: string): 'Breakfast' | 'Lunch' | 'Dinner' => {
  const [hours, minutes] = time.split(':').map(Number);
  const total = hours * 60 + minutes;
  if (total >= 4 * 60 && total < 10 * 60 + 30) return 'Breakfast';
  if (total >= 10 * 60 + 30 && total < 15 * 60 + 30) return 'Lunch';
  return 'Dinner';
};

const categoryFor = (type: EstablishmentType | null, time: string | null): ExpenseCategory | null => {
  if (!type) return null;
  if (FOOD_SERVICE.has(type) && time) return mealForTime(time);
  switch (type) {
    case 'cafe': return 'Breakfast';
    case 'restaurant':
    case 'bar':
    case 'fast_food':
    case 'grocery': return 'Other Food';
    case 'transport': return 'Rides';
    case 'shop': return 'Souvenirs';
    default: return null;
  }
};

// ---------------------------------------------------------------------------------------------

export const parseReceiptText = async (text: string, options: ReceiptParseOptions = {}): Promise<ParsedReceiptExpenseDraft> => {
  const lines = text.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const vendor = extractVendor(lines);
  const currency = extractCurrency(text, options.fallbackCurrency);
  const date = extractDate(text, { ...options, currency });
  const time = extractTime(text);
  const amount = extractAmount(lines);

  const providerSuggestion = vendor ? await lookupMerchantCategory({ vendor, destination: options.destination }) : null;
  const establishmentType =
    establishmentFromProvider(providerSuggestion?.providerCategory, providerSuggestion?.providerType)
    ?? establishmentFromText(vendor, lines.slice(0, 6).filter((line) => !looksLikeAddressOrNumber(line) && !DATE_OR_TIME.test(line)));
  const category = categoryFor(establishmentType, time) ?? providerSuggestion?.category ?? 'Other';

  const confidenceParts = [vendor ? 0.2 : 0, date ? 0.2 : 0, amount ? 0.3 : 0, currency ? 0.1 : 0, establishmentType || providerSuggestion ? 0.2 : 0];
  const confidence = Math.min(0.95, confidenceParts.reduce((sum, value) => sum + value, 0));
  return {
    expenseDate: date,
    expenseTime: time,
    amount,
    currency,
    vendor,
    category,
    establishmentType,
    notes: null,
    confidence,
    rawSignals: {
      merchantCategorySource: providerSuggestion?.provider ?? null,
      merchantCategory: providerSuggestion?.providerType ?? providerSuggestion?.providerCategory ?? null,
    },
  };
};

export const parseReceiptImage = async (
  bytes: Buffer,
  mimeType: string,
  options: ReceiptParseOptions = {}
): Promise<ParsedReceiptExpenseDraft> => {
  const text = await extractImageTextViaOcr(bytes, mimeType);
  return parseReceiptText(text, options);
};
