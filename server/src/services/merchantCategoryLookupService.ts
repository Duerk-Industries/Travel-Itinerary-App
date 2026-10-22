import { getFeatureFlag, listAttractionCatalogEntries } from '../db';
import { resolveCatalogCoordinates } from './geocodingService';
import { normalizeDestinationKey } from './attractionsCatalogService';

export type ExpenseCategory =
  | 'Breakfast'
  | 'Lunch'
  | 'Dinner'
  | 'Other Food'
  | 'Rides'
  | 'Souvenirs'
  | 'Other';

export type MerchantCategoryLookupInput = {
  vendor: string;
  destination?: string | null;
  country?: string | null;
};

export type MerchantCategorySuggestion = {
  category: ExpenseCategory;
  confidence: number;
  provider: 'nominatim';
  providerCategory?: string | null;
  providerType?: string | null;
};

const normalize = (value: unknown): string => String(value ?? '').trim().toLowerCase();

export const mapMerchantCategory = (
  providerCategory?: string | null,
  providerType?: string | null,
  vendor?: string | null
): MerchantCategorySuggestion | null => {
  const category = normalize(providerCategory);
  const type = normalize(providerType);
  const text = `${category} ${type} ${normalize(vendor)}`;

  const suggestion = (expenseCategory: ExpenseCategory, confidence: number): MerchantCategorySuggestion => ({
    category: expenseCategory,
    confidence,
    provider: 'nominatim',
    providerCategory: providerCategory ?? null,
    providerType: providerType ?? null,
  });

  if (/\b(cafe|coffee|bakery|breakfast)\b/.test(text)) return suggestion('Breakfast', 0.85);
  if (/\b(restaurant|fast_food|food_court|deli|bar|pub|ice_cream)\b/.test(text)) return suggestion('Other Food', 0.8);
  if (/\b(supermarket|convenience|grocery|greengrocer)\b/.test(text)) return suggestion('Other Food', 0.7);
  if (/\b(fuel|taxi|car_rental|parking|transport|bus_station|train_station)\b/.test(text)) return suggestion('Rides', 0.75);
  if (/\b(souvenir|gift|mall|department_store)\b/.test(text)) return suggestion('Souvenirs', 0.75);
  return null;
};

export const lookupMerchantCategory = async (input: MerchantCategoryLookupInput): Promise<MerchantCategorySuggestion | null> => {
  if (!(await getFeatureFlag('merchant_category_lookup'))?.enabled || !input.destination) return null;
  try {
    const entries = await listAttractionCatalogEntries('', normalizeDestinationKey(input.destination), 2000);
    const entry = entries.find(entry => normalize(entry.name) === normalize(input.vendor));
    if (!entry) return null;
    const result = await resolveCatalogCoordinates(entry);
    return result ? mapMerchantCategory(result.providerCategory, result.providerType, entry.name) : null;
  } catch { return null; }
};
export const clearMerchantCategoryCacheForTests = (): void => { /* Durable cache has no process-local reset. */ };
