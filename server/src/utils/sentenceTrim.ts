// Splits text into sentences and returns the first `maxSentences`, without
// breaking mid-sentence on a decimal number (e.g. "2.5-mile-long (4.0 km)")
// or a name abbreviation (e.g. "John F. Kennedy", "St. Patrick's Cathedral").
// A naive `/[^.!?]+[.!?]+/g` split treats every period as a sentence end,
// which cuts text like "The Freedom Trail is a 2.5-mile-long (4.0 km) trail"
// into "The Freedom Trail is a 2." + " 5-mile-long (4." — visibly truncated
// mid-number — and cuts "...museum of John F. Kennedy, the 35th president"
// into "...museum of John F." with the rest of the name dropped entirely.
// Protected periods are swapped for a Unicode private-use placeholder that
// real text won't contain, then restored after the sentence split.
const PROTECTED_POINT_PLACEHOLDER = '';

// A lone capital letter immediately followed by a period and another
// capitalized word is almost always a middle initial ("John F. Kennedy"),
// not a sentence boundary — a real one-letter sentence ("I. Go home.") is
// vanishingly rare in an attraction summary.
const MIDDLE_INITIAL_PATTERN = /\b([A-Z])\.(\s+[A-Z])/g;

// Common titles/honorifics/directionals that are almost never the end of a
// sentence when followed by another word — e.g. "St. Patrick's Cathedral",
// "Dr. Martin Luther King Jr. Memorial", "Mt. Rainier".
const ABBREVIATION_PATTERN = /\b(St|Mt|Dr|Mrs|Mr|Ms|Jr|Sr|Ste|Ft|No|Ave|Blvd|Rd)\.(\s+\S)/gi;

export const trimToSentences = (text: string, maxSentences: number): string => {
  const protectedText = text
    .replace(/(\d)\.(\d)/g, '$1' + PROTECTED_POINT_PLACEHOLDER + '$2')
    .replace(MIDDLE_INITIAL_PATTERN, '$1' + PROTECTED_POINT_PLACEHOLDER + '$2')
    .replace(ABBREVIATION_PATTERN, '$1' + PROTECTED_POINT_PLACEHOLDER + '$2');
  const sentences = protectedText.match(/[^.!?]+[.!?]+/g) ?? [protectedText];
  return sentences
    .slice(0, Math.max(1, maxSentences))
    .map((sentence) => sentence.trim())
    .join(' ')
    .trim()
    .split(PROTECTED_POINT_PLACEHOLDER)
    .join('.');
};
