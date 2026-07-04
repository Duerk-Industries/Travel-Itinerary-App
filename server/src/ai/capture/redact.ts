const REDACTION_PATTERNS: RegExp[] = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g,
  /\b(?:passport|passaport|id|license|licence|ssn)\s*(?:number|no\.?|#)?\s*[:#-]?\s*[A-Z0-9-]{5,}\b/gi,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{10,}\b/g,
  /\b(?:tok|pk|sk|sess|cookie)_[A-Za-z0-9_]{8,}\b/g,
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
];

export type RedactionResult<T> = {
  value: T;
  redactionApplied: boolean;
};

const redactString = (value: string): RedactionResult<string> => {
  let redacted = value;
  for (const pattern of REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  return { value: redacted, redactionApplied: redacted !== value };
};

export const redactAllowedFreeText = <T>(value: T): RedactionResult<T> => {
  let redactionApplied = false;

  const visit = (input: unknown): unknown => {
    if (typeof input === 'string') {
      const redacted = redactString(input);
      redactionApplied ||= redacted.redactionApplied;
      return redacted.value;
    }
    if (Array.isArray(input)) {
      return input.map((item) => visit(item));
    }
    if (input && typeof input === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(input)) {
        output[key] = visit(child);
      }
      return output;
    }
    return input;
  };

  // Best-effort regex redaction for the narrow free-text fragments that already
  // passed the production allowlist. The allowlist is the enforcement boundary;
  // regex redaction is not a compliance guarantee.
  return { value: visit(value) as T, redactionApplied };
};
