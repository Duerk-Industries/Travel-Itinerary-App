const MINIMUM_ACCOUNT_AGE = 16;

export const MINIMUM_ACCOUNT_AGE_YEARS = MINIMUM_ACCOUNT_AGE;

export const parseDateOfBirth = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const normalized = value.trim();
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) return null;
  if (date.getTime() > Date.now()) return null;
  return normalized;
};

export const isOldEnoughToHoldAnAccount = (dateOfBirth: string, now = new Date()): boolean => {
  const birth = new Date(`${dateOfBirth}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime())) return false;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const birthdayThisYear = new Date(Date.UTC(today.getUTCFullYear(), birth.getUTCMonth(), birth.getUTCDate()));
  if (today < birthdayThisYear) age -= 1;
  return age >= MINIMUM_ACCOUNT_AGE;
};

export const validateRegistrationAge = (value: unknown): { dateOfBirth: string | null; pending: boolean } | { error: string } => {
  // Existing clients and grandfathered accounts may omit DOB during the
  // staged rollout. Such accounts can use private trip features, but public
  // publication consent requires the profile to be completed.
  if (value == null || value === '') return { dateOfBirth: null, pending: true };
  const dateOfBirth = parseDateOfBirth(value);
  if (!dateOfBirth) return { error: 'dateOfBirth must be a valid YYYY-MM-DD date' };
  if (!isOldEnoughToHoldAnAccount(dateOfBirth)) {
    return { error: `You must be at least ${MINIMUM_ACCOUNT_AGE} years old to create an account` };
  }
  return { dateOfBirth, pending: false };
};
