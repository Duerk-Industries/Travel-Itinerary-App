// Parses the small HTML subset the trip-blog editor (TipTap) emits into plain data that can be
// rendered with React Native <Text>/<View>. Nothing here ever builds or injects HTML: unknown tags
// are dropped (their text kept), script/style contents are discarded, and only http(s)/mailto
// links survive, so rendering another traveler's note cannot inject markup or script.

export type BlogHtmlRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string;
};

export type BlogHtmlBlock = {
  kind: 'paragraph' | 'heading' | 'listItem' | 'quote';
  level?: number;
  /** 1-based position for ordered lists; undefined for bullets. */
  ordinal?: number;
  runs: BlogHtmlRun[];
};

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export const decodeHtmlEntities = (value: string): string =>
  value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });

const safeHref = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  const href = decodeHtmlEntities(raw).trim();
  return /^(https?:|mailto:)/i.test(href) ? href : undefined;
};

const attr = (attrs: string, name: string): string | undefined => {
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
};

const TOKEN = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)|</g;
const SKIPPED_CONTENT = new Set(['script', 'style']);

const isBlank = (block: BlogHtmlBlock): boolean => block.runs.every((run) => !run.text.trim());

export const parseBlogHtml = (html: string): BlogHtmlBlock[] => {
  const blocks: BlogHtmlBlock[] = [];
  let current: BlogHtmlBlock | null = null;
  const marks = { bold: 0, italic: 0, underline: 0, strike: 0, code: 0 };
  const links: Array<string | undefined> = [];
  const lists: Array<{ ordered: boolean; count: number }> = [];
  let quoteDepth = 0;
  let skipUntil: string | null = null;

  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };
  const open = (kind: BlogHtmlBlock['kind'], extra: Partial<BlogHtmlBlock> = {}) => {
    flush();
    current = { kind, runs: [], ...extra };
  };
  const ensure = (): BlogHtmlBlock => {
    if (!current) current = { kind: quoteDepth > 0 ? 'quote' : 'paragraph', runs: [] };
    return current;
  };
  const push = (text: string) => {
    if (!text) return;
    const href = links.length ? links[links.length - 1] : undefined;
    ensure().runs.push({
      text,
      ...(marks.bold ? { bold: true } : {}),
      ...(marks.italic ? { italic: true } : {}),
      ...(marks.underline ? { underline: true } : {}),
      ...(marks.strike ? { strike: true } : {}),
      ...(marks.code ? { code: true } : {}),
      ...(href ? { href } : {}),
    });
  };

  const source = String(html ?? '');
  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(source))) {
    const [, closing, rawTag, attrs, text] = match;
    if (rawTag === undefined) {
      if (skipUntil) continue;
      // Text between tags, or a stray "<" that isn't a tag.
      push(text !== undefined ? decodeHtmlEntities(text.replace(/\s*\n\s*/g, ' ')) : '<');
      continue;
    }
    const tag = rawTag.toLowerCase();
    const isClosing = closing === '/';
    if (skipUntil) {
      if (isClosing && tag === skipUntil) skipUntil = null;
      continue;
    }
    if (!isClosing && SKIPPED_CONTENT.has(tag)) { skipUntil = tag; continue; }

    switch (tag) {
      case 'p':
      case 'div':
        if (isClosing) flush(); else open(quoteDepth > 0 ? 'quote' : 'paragraph');
        break;
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        if (isClosing) flush(); else open('heading', { level: Number(tag[1]) });
        break;
      case 'blockquote':
        flush();
        quoteDepth = Math.max(0, quoteDepth + (isClosing ? -1 : 1));
        break;
      case 'ul':
      case 'ol':
        flush();
        if (isClosing) lists.pop(); else lists.push({ ordered: tag === 'ol', count: 0 });
        break;
      case 'li':
        if (isClosing) { flush(); break; }
        {
          const list = lists[lists.length - 1];
          if (list) list.count += 1;
          open('listItem', { ordinal: list?.ordered ? list.count : undefined });
        }
        break;
      case 'br':
        push('\n');
        break;
      case 'hr':
        flush();
        break;
      case 'strong': case 'b': marks.bold = Math.max(0, marks.bold + (isClosing ? -1 : 1)); break;
      case 'em': case 'i': marks.italic = Math.max(0, marks.italic + (isClosing ? -1 : 1)); break;
      case 'u': marks.underline = Math.max(0, marks.underline + (isClosing ? -1 : 1)); break;
      case 's': case 'strike': case 'del': marks.strike = Math.max(0, marks.strike + (isClosing ? -1 : 1)); break;
      case 'code': marks.code = Math.max(0, marks.code + (isClosing ? -1 : 1)); break;
      case 'a':
        if (isClosing) links.pop(); else links.push(safeHref(attr(attrs, 'href')));
        break;
      default:
        break; // Unknown tag: ignored, inner text kept.
    }
  }
  flush();

  // Drop empty paragraphs at the start and end -- the editor emits `<p></p>` for blank lines, which
  // used to render as a block of trailing whitespace. Interior blanks are kept as spacing.
  while (blocks.length && isBlank(blocks[blocks.length - 1])) blocks.pop();
  while (blocks.length && isBlank(blocks[0])) blocks.shift();
  return blocks;
};
