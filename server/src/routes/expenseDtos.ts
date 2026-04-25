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

export const listExpensesQueryDto = z.object({
  tripId: trimmedNonEmpty('tripId'),
});
export type ListExpensesQueryDto = z.infer<typeof listExpensesQueryDto>;

export const createExpenseDto = z.object({
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
  notes: z
    .unknown()
    .optional()
    .transform((value) => (typeof value === 'string' ? value.trim() || null : null)),
});
export type CreateExpenseDto = z.infer<typeof createExpenseDto>;
