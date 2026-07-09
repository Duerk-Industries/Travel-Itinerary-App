import type { ExtractionResult, ParsedItemCandidate } from '../../ingestion/contracts';

export type FieldComparison =
  | { fieldName: string; status: 'same' }
  | { fieldName: string; status: 'production_only'; productionValue: unknown }
  | { fieldName: string; status: 'llm_only'; llmValue: unknown }
  | { fieldName: string; status: 'both_different'; productionValue: unknown; llmValue: unknown };

export type ItemComparison = {
  itemType: string;
  fieldComparisons: FieldComparison[];
  agreementRate: number;
};

export type ComparisonReport = {
  productionItemCount: number;
  llmItemCount: number;
  itemComparisons: ItemComparison[];
  agreementRate: number;
};

const stableValue = (value: unknown): string => JSON.stringify(value ?? null);

const compareItemFields = (production: ParsedItemCandidate, llm: ParsedItemCandidate): ItemComparison => {
  const productionFields = production.extractedFields ?? {};
  const llmFields = llm.extractedFields ?? {};
  const fieldNames = Array.from(new Set([...Object.keys(productionFields), ...Object.keys(llmFields)])).sort();
  const fieldComparisons = fieldNames.map((fieldName): FieldComparison => {
    const productionHas = productionFields[fieldName] !== undefined && productionFields[fieldName] !== null && productionFields[fieldName] !== '';
    const llmHas = llmFields[fieldName] !== undefined && llmFields[fieldName] !== null && llmFields[fieldName] !== '';
    if (productionHas && llmHas && stableValue(productionFields[fieldName]) === stableValue(llmFields[fieldName])) {
      return { fieldName, status: 'same' };
    }
    if (productionHas && !llmHas) return { fieldName, status: 'production_only', productionValue: productionFields[fieldName] };
    if (!productionHas && llmHas) return { fieldName, status: 'llm_only', llmValue: llmFields[fieldName] };
    return {
      fieldName,
      status: 'both_different',
      productionValue: productionFields[fieldName],
      llmValue: llmFields[fieldName],
    };
  });
  const sameCount = fieldComparisons.filter((field) => field.status === 'same').length;
  return {
    itemType: production.itemType,
    fieldComparisons,
    agreementRate: fieldComparisons.length ? sameCount / fieldComparisons.length : 1,
  };
};

export const compareExtractionResults = (
  productionResult: ExtractionResult,
  llmResult: ExtractionResult
): ComparisonReport => {
  const productionItems = productionResult.parsedItems;
  const llmItems = llmResult.parsedItems;
  const itemComparisons = productionItems.map((productionItem, index) => {
    const matchingLlm =
      llmItems.find((item) => item.itemType === productionItem.itemType) ??
      llmItems[index] ??
      ({ itemType: productionItem.itemType, extractedFields: {} } as ParsedItemCandidate);
    return compareItemFields(productionItem, matchingLlm);
  });
  const agreementRate = itemComparisons.length
    ? itemComparisons.reduce((sum, item) => sum + item.agreementRate, 0) / itemComparisons.length
    : 1;
  return {
    productionItemCount: productionItems.length,
    llmItemCount: llmItems.length,
    itemComparisons,
    agreementRate,
  };
};
