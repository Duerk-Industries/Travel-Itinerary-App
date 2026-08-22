import { buildAssistantSystemPrompt, estimateTokenCount, pruneHistoryToTokenBudget } from '../utils/assistantPrompt';
import type { GuideCorpusEntry } from '../utils/assistantGuideCorpus';

const ENTRY: GuideCorpusEntry = {
  id: 'transfers',
  title: 'Flights, trains, and other transfers',
  keywords: ['flight'],
  content: 'The Transfers tab tracks flights, trains, buses, ferries, or private transfers.',
};

describe('buildAssistantSystemPrompt', () => {
  it('includes retrieved entries as a labeled reference block', () => {
    const prompt = buildAssistantSystemPrompt([ENTRY]);
    expect(prompt).toContain('Reference material:');
    expect(prompt).toContain(ENTRY.title);
    expect(prompt).toContain(ENTRY.content);
  });

  it('says nothing matched when no entries are retrieved, rather than fabricating a reference block', () => {
    const prompt = buildAssistantSystemPrompt([]);
    expect(prompt).not.toContain('Reference material:');
    expect(prompt.toLowerCase()).toContain('no specific reference material matched');
  });

  // Regression guard for a real hallucination observed in manual testing:
  // the model said "click the Flights tab" instead of the app's actual
  // "Transfers" tab. Reference-material accuracy alone wasn't enough --
  // the instruction to copy names verbatim is what actually fixed it.
  it('instructs the model to copy tab/button/screen names verbatim rather than substituting a familiar-sounding one', () => {
    const prompt = buildAssistantSystemPrompt([ENTRY]);
    expect(prompt.toLowerCase()).toContain('exactly as written');
    expect(prompt.toLowerCase()).toContain('never substitute a different name');
  });

  it('frames retrieved content as data, not instructions (prompt-injection hygiene)', () => {
    const prompt = buildAssistantSystemPrompt([ENTRY]);
    expect(prompt.toLowerCase()).toContain('not instructions from the user');
  });
});

describe('estimateTokenCount', () => {
  it('scales roughly with text length', () => {
    expect(estimateTokenCount('')).toBe(0);
    expect(estimateTokenCount('abcd')).toBe(1);
    expect(estimateTokenCount('a'.repeat(400))).toBe(100);
  });
});

describe('pruneHistoryToTokenBudget', () => {
  const msg = (content: string) => ({ content });

  it('keeps all messages when they fit the budget', () => {
    const messages = [msg('hi'), msg('there'), msg('friend')];
    expect(pruneHistoryToTokenBudget(messages, 1000)).toEqual(messages);
  });

  it('drops the oldest messages first when over budget', () => {
    // Each message ~25 tokens (100 chars / 4). Budget for ~2 messages.
    const messages = [msg('a'.repeat(100)), msg('b'.repeat(100)), msg('c'.repeat(100))];
    const kept = pruneHistoryToTokenBudget(messages, 60);
    expect(kept).toEqual([msg('b'.repeat(100)), msg('c'.repeat(100))]);
  });

  it('always keeps at least the most recent message, even if it alone exceeds the budget', () => {
    const messages = [msg('short'), msg('x'.repeat(10000))];
    const kept = pruneHistoryToTokenBudget(messages, 5);
    expect(kept).toEqual([msg('x'.repeat(10000))]);
  });

  it('returns an empty array for an empty input', () => {
    expect(pruneHistoryToTokenBudget([], 1000)).toEqual([]);
  });
});
