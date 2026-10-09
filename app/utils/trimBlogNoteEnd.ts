// TipTap stores notes as HTML. Trim whitespace inside the final text node as well as
// empty paragraphs left at the end, without changing spaces between words/blocks.
export const trimBlogNoteEnd = (html: string): string => {
  let result = String(html ?? '').trimEnd();
  let previous: string;
  do {
    previous = result;
    result = result.replace(/(?:\s|&nbsp;|&#160;|&#x[aA]0;)+(?=(?:<\/[a-z][^>]*>)*$)/gi, '');
    result = result.replace(/<(p|div)(?:\s[^>]*)?>\s*(?:(?:<br\s*\/?>|&nbsp;|&#160;|&#x[aA]0;)\s*)*<\/\1>\s*$/i, '');
  } while (result !== previous);
  return result;
};
