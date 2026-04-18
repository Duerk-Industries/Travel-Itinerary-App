export const sanitizeCostInput = (value: string): string => {
  if (!value) return '';
  const normalized = value.replace(/,/g, ' ');
  const currencyMatches = Array.from(
    normalized.matchAll(
      /(?:[$€£]|USD|EUR|GBP|CAD|AUD|CHF|JPY|NZD|RON|BGN|HUF|PLN)\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:USD|EUR|GBP|CAD|AUD|CHF|JPY|NZD|RON|BGN|HUF|PLN)/gi
    )
  )
    .map((match) => match[1] ?? match[2] ?? '')
    .filter(Boolean);
  if (currencyMatches.length) return currencyMatches[currencyMatches.length - 1];

  const decimalMatches = Array.from(normalized.matchAll(/\d+(?:\.\d{1,2})/g)).map((match) => match[0]);
  if (decimalMatches.length) return decimalMatches[decimalMatches.length - 1];

  const cleaned = value.replace(/[^0-9.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  if (rest.length === 0) return cleaned;
  return `${whole}.${rest.join('')}`;
};

export const parseCostNumber = (value: string): number => {
  const sanitized = sanitizeCostInput(value);
  return sanitized ? Number(sanitized) : 0;
};
