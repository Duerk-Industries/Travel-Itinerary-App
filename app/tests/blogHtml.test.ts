/// <reference types="jest" />
import { parseBlogHtml } from '../utils/blogHtml';

const texts = (html: string) => parseBlogHtml(html).map((block) => block.runs.map((run) => run.text).join(''));

describe('parseBlogHtml', () => {
  it('drops empty paragraphs at the start and end (the trailing blank space) but keeps interior spacing', () => {
    expect(texts('<p></p><p>First</p><p></p><p>Second</p><p></p><p></p>')).toEqual(['First', '', 'Second']);
    expect(texts('<p></p>')).toEqual([]);
    expect(texts('')).toEqual([]);
  });

  it('keeps marks, line breaks and entities', () => {
    const [block] = parseBlogHtml('<p>Hello <strong>bold <em>both</em></strong><br>next &amp; done &#39;x&#39;</p>');
    expect(block.runs).toEqual([
      { text: 'Hello ' },
      { text: 'bold ', bold: true },
      { text: 'both', bold: true, italic: true },
      { text: '\n' },
      { text: "next & done 'x'" },
    ]);
  });

  it('handles headings, bullet and numbered lists, and quotes', () => {
    const blocks = parseBlogHtml('<h2>Title</h2><ul><li>a</li><li>b</li></ul><ol><li>one</li><li>two</li></ol><blockquote><p>quoted</p></blockquote>');
    expect(blocks.map((b) => [b.kind, b.level, b.ordinal, b.runs[0].text])).toEqual([
      ['heading', 2, undefined, 'Title'],
      ['listItem', undefined, undefined, 'a'],
      ['listItem', undefined, undefined, 'b'],
      ['listItem', undefined, 1, 'one'],
      ['listItem', undefined, 2, 'two'],
      ['quote', undefined, undefined, 'quoted'],
    ]);
  });

  describe('safety (another traveler authors this HTML)', () => {
    it('keeps only http(s)/mailto links', () => {
      const runs = (html: string) => parseBlogHtml(html)[0].runs;
      expect(runs('<p><a href="https://example.com/x?a=1&amp;b=2">ok</a></p>')[0].href).toBe('https://example.com/x?a=1&b=2');
      expect(runs('<p><a href="mailto:a@b.co">m</a></p>')[0].href).toBe('mailto:a@b.co');
      expect(runs('<p><a href="javascript:alert(1)">bad</a></p>')[0].href).toBeUndefined();
      expect(runs('<p><a href="JaVaScRiPt:alert(1)">bad</a></p>')[0].href).toBeUndefined();
      expect(runs('<p><a href="data:text/html;base64,AAAA">bad</a></p>')[0].href).toBeUndefined();
    });

    it('discards script and style contents and ignores unknown tags and attributes', () => {
      expect(texts('<p>safe</p><script>alert(1)</script><style>p{x:y}</style><p onclick="x()">still <img src=x onerror=alert(1)>text</p>'))
        .toEqual(['safe', 'still text']);
    });

    it('treats a stray "<" as text and never throws on malformed input', () => {
      expect(texts('<p>1 < 2</p>')).toEqual(['1 < 2']);
      expect(() => parseBlogHtml('<p><strong>unclosed <a href="x">')).not.toThrow();
      expect(() => parseBlogHtml('</p></ul></li></blockquote></a></strong>')).not.toThrow();
    });
  });
});
