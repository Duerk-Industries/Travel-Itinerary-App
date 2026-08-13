import { buildNarrativeBlogBody } from '../src/blog/narrative';

describe('buildNarrativeBlogBody', () => {
  it('turns activity metadata into one readable sentence', () => {
    expect(buildNarrativeBlogBody({
      activity: 'Tokyo Skytree',
      kind: 'place',
      noteBody: 'Why this fits your group: everyone enjoys panoramic views.',
    })).toBe('Tokyo Skytree is a stop your group may enjoy because everyone enjoys panoramic views.');
  });

  it('does not emit a heading for an empty logistics note', () => {
    expect(buildNarrativeBlogBody({ activity: '', kind: 'note', noteBody: '  ' })).toBe('');
  });

  it('preserves a meaningful logistics note body', () => {
    expect(buildNarrativeBlogBody({ kind: 'note', noteBody: 'Take the metro to Shibuya.' })).toBe('Take the metro to Shibuya.');
  });
});
