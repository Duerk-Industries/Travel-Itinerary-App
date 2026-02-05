export const sanitizeCostInput = (value: string): string => {
  if (!value) return '';
  const cleaned = value.replace(/[^0-9.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  if (rest.length === 0) return cleaned;
  return `${whole}.${rest.join('')}`;
};

export const parseCostNumber = (value: string): number => {
  const sanitized = sanitizeCostInput(value);
  return sanitized ? Number(sanitized) : 0;
};
