import { trimBlogNoteEnd } from '../utils/trimBlogNoteEnd';

describe('trimBlogNoteEnd', () => {
  it('trims trailing spaces in plain and rich-text notes', () => {
    expect(trimBlogNoteEnd('A great day.  \n')).toBe('A great day.');
    expect(trimBlogNoteEnd('<p>A great day.&nbsp;  </p>')).toBe('<p>A great day.</p>');
    expect(trimBlogNoteEnd('<p>A great day.  </p><p><br></p>')).toBe('<p>A great day.</p>');
  });

  it('keeps spaces and formatting within the note', () => {
    expect(trimBlogNoteEnd('<p>New York</p><p><strong>Great food</strong> here</p>'))
      .toBe('<p>New York</p><p><strong>Great food</strong> here</p>');
  });
});
