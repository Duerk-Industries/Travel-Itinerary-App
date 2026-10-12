/// <reference types="jest" />
import {
  KEEPSAKE_THEMES,
  buildKeepsakeHtml,
  formatKeepsakeDay,
  formatKeepsakeRange,
  getKeepsakeTheme,
  paragraphsFromRichText,
} from '../utils/keepsake';

const blog = {
  title: 'Lisbon Long Weekend',
  subtitle: 'Trams, tarts & fado',
  introduction: '<p>Four friends, five days.</p>',
  days: [
    { localDate: '2026-10-29', headline: 'Hello, Lisbon!', summary: null, items: [
      { kindKey: 'core.text', body: '<p>Got lost in Alfama.</p><p>Dinner at <b>Time Out</b> &amp; fado.</p>' },
      { kindKey: 'core.gallery', assets: [{ mediaKind: 'photo', primaryUrl: 'https://img/1.jpg', caption: 'Rooftops' }] },
    ] },
    { localDate: '2026-10-30', headline: null, summary: null, items: [] },
    { localDate: '2026-11-02', headline: 'Heading home', summary: 'Last pastries', items: [] },
  ],
};

describe('keepsake themes', () => {
  it('falls back to the default theme for unknown keys', () => {
    expect(getKeepsakeTheme('nope').key).toBe('linen');
    expect(getKeepsakeTheme('midnight').key).toBe('midnight');
  });

  it('applies each theme\'s colors to the document', () => {
    for (const theme of KEEPSAKE_THEMES) {
      const html = buildKeepsakeHtml(blog, theme.key);
      expect(html).toContain(`--page:${theme.page}`);
      expect(html).toContain(`--accent:${theme.accent}`);
    }
  });
});

describe('buildKeepsakeHtml', () => {
  const html = buildKeepsakeHtml(blog, 'coastal');

  it('includes the title, a readable date range and readable day dates', () => {
    expect(html).toContain('<h1>Lisbon Long Weekend</h1>');
    expect(html).toContain('Oct 29 – Nov 2, 2026');
    expect(html).toContain('Thursday, October 29');
  });

  it('keeps note paragraphs, decodes entities and escapes text', () => {
    expect(html).toContain('<p>Got lost in Alfama.</p>');
    expect(html).toContain('<p>Dinner at Time Out &amp; fado.</p>');
    expect(html).not.toContain('<b>');
  });

  it('includes photos with captions', () => {
    expect(html).toContain('src="https://img/1.jpg"');
    expect(html).toContain('<figcaption>Rooftops</figcaption>');
  });

  it('leaves out days with nothing on them', () => {
    expect(html).not.toContain('Friday, October 30');
    expect(html).toContain('Monday, November 2');
  });
});

describe('helpers', () => {
  it('splits rich text into paragraphs', () => {
    expect(paragraphsFromRichText('<p>One</p><p>Two<br>Three</p>')).toEqual(['One', 'Two', 'Three']);
  });

  it('formats dates without timezone drift', () => {
    expect(formatKeepsakeDay('2026-08-15')).toBe('Saturday, August 15');
    expect(formatKeepsakeRange(['2026-08-15'])).toBe('Aug 15, 2026');
    expect(formatKeepsakeRange(['2026-12-30', '2027-01-02'])).toBe('Dec 30, 2026 – Jan 2, 2027');
  });
});
