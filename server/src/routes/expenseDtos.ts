import { z } from 'zod';

const trimmedNonEmpty = (label: string) =>
  z
    .string({ message: `${label} must be a string.` })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: `${label} is required.` });

const normalizedNumber = z
  .unknown()
  .optional()
  .transform((value) => (value == null ? 0 : Number(value) || 0));

const nullableNormalizedNumber = z
  .unknown()
  .optional()
  .transform((value) => (value == null ? null : Number(value) || 0));

const idList = z
  .array(z.unknown(), { message: 'Expected an array of ids.' })
  .optional()
  .default([])
  .transform((ids) => ids.map((id) => String(id)).filter(Boolean));

// Weight per traveler for an uneven split. Keeps only positive, finite weights for travelers the
// expense is for; an empty result, or weights that are all equal, mean the ordinary equal split.
const MAX_SHARE_WEIGHT = 100;
export const normalizeForShares = (value: unknown, forIds: string[]): Record<string, number> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowed = new Set(forIds);
  const shares: Record<string, number> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    const weight = Math.round(Number(raw) * 100) / 100;
    if (allowed.has(id) && Number.isFinite(weight) && weight > 0 && weight <= MAX_SHARE_WEIGHT) shares[id] = weight;
  }
  const weights = forIds.map((id) => shares[id] ?? 1);
  if (!Object.keys(shares).length || weights.every((weight) => weight === weights[0])) return null;
  return forIds.reduce<Record<string, number>>((all, id) => ({ ...all, [id]: shares[id] ?? 1 }), {});
};

const nullableTrimmedText = (label: string, maxLength: number) =>
  z
    .unknown()
    .optional()
    .transform((value) => (typeof value === 'string' ? value.trim() || null : null))
    .refine((value) => value == null || value.length <= maxLength, {
      message: `${label} must be ${maxLength} characters or fewer.`,
    });

export const listExpensesQueryDto = z.object({
  tripId: trimmedNonEmpty('tripId'),
});
export type ListExpensesQueryDto = z.infer<typeof listExpensesQueryDto>;

export const createExpenseDto = z.object({
  forShares: z.unknown().optional(),
  tripId: trimmedNonEmpty('tripId'),
  expenseDate: trimmedNonEmpty('expenseDate'),
  category: trimmedNonEmpty('category'),
  amount: normalizedNumber,
  currency: z
    .unknown()
    .optional()
    .transform((value) =>
      typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : undefined
    ),
  amountInTripCurrency: nullableNormalizedNumber,
  exchangeRateToTripCurrency: nullableNormalizedNumber,
  exchangeRateDate: z
    .unknown()
    .optional()
    .transform((value) => (typeof value === 'string' ? value.trim() || null : null)),
  payerIds: idList,
  forIds: idList,
  vendor: nullableTrimmedText('vendor', 160),
  notes: nullableTrimmedText('notes', 2000),
}).transform((dto) => ({ ...dto, forShares: normalizeForShares(dto.forShares, dto.forIds) }));
export type CreateExpenseDto = z.infer<typeof createExpenseDto>;

// Editing a daily expense replaces the same set of user-editable fields as creation.
export const updateExpenseDto = createExpenseDto;
export type UpdateExpenseDto = z.infer<typeof updateExpenseDto>;
