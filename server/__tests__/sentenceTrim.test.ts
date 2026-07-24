/// <reference types="jest" />
import { trimToSentences } from '../src/utils/sentenceTrim';

describe('trimToSentences', () => {
  test('does not truncate mid-sentence on a decimal number', () => {
    // Regression case: a real Boston/New York trip rendered "The Freedom
    // Trail is a 2. 5-mile-long (4." — the naive `/[^.!?]+[.!?]+/g` split
    // treated the decimal points in "2.5" and "4.0" as sentence boundaries.
    const text =
      'The Freedom Trail is a 2.5-mile-long (4.0 km) trail through downtown Boston that passes 16 locations significant to the history of the United States. It is a National Historic Landmark route. It was created in 1951.';
    const result = trimToSentences(text, 2);
    expect(result).not.toMatch(/\d\.\s\d/);
    expect(result).toBe(
      'The Freedom Trail is a 2.5-mile-long (4.0 km) trail through downtown Boston that passes 16 locations significant to the history of the United States. It is a National Historic Landmark route.'
    );
  });

  test('keeps only the requested number of real sentences', () => {
    const text = 'Sentence one. Sentence two. Sentence three. Sentence four.';
    expect(trimToSentences(text, 2)).toBe('Sentence one. Sentence two.');
    expect(trimToSentences(text, 1)).toBe('Sentence one.');
  });

  test('handles a decimal number at the very end of the requested slice', () => {
    const text = 'A fact with a number like 3.14 right at the end. Another sentence after it.';
    expect(trimToSentences(text, 1)).toBe('A fact with a number like 3.14 right at the end.');
  });

  test('falls back to the whole text when there is no sentence-ending punctuation', () => {
    expect(trimToSentences('no terminal punctuation here', 2)).toBe('no terminal punctuation here');
  });

  test('handles multiple decimal numbers in the same sentence', () => {
    const text = 'The trail is 2.5 miles, covers 4.0 km, and has 16.2 stops on average. Second sentence.';
    expect(trimToSentences(text, 1)).toBe('The trail is 2.5 miles, covers 4.0 km, and has 16.2 stops on average.');
  });

  test('does not truncate on a middle-initial abbreviation', () => {
    // Regression case: a real replay rendered "...presidential library and
    // museum of John F." — the naive split treated the period in "John F."
    // as a sentence boundary and dropped "Kennedy" and everything after it.
    const text =
      'The John F. Kennedy Presidential Library and Museum is the presidential library and museum of John F. Kennedy, the 35th president of the United States. It is located in Boston.';
    const result = trimToSentences(text, 1);
    expect(result).not.toMatch(/John F\.$/);
    expect(result).toBe(
      'The John F. Kennedy Presidential Library and Museum is the presidential library and museum of John F. Kennedy, the 35th president of the United States.'
    );
  });

  test('does not truncate on a common title/honorific abbreviation', () => {
    const text = "St. Patrick's Cathedral is a Neo-Gothic Catholic cathedral in Manhattan. It is a major tourist attraction.";
    expect(trimToSentences(text, 1)).toBe("St. Patrick's Cathedral is a Neo-Gothic Catholic cathedral in Manhattan.");
  });
});
