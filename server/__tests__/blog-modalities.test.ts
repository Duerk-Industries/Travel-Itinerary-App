import { getBlogItemDescriptor, listBlogItemDescriptors } from '../src/blog/registry';

describe('trip blog modality registry', () => {
  it('exposes lifecycle descriptors for future modalities', () => {
    expect(getBlogItemDescriptor('core.gallery')?.featureFlag).toBe('trip_blog_galleries');
    expect(getBlogItemDescriptor('core.structured_card')?.supportsExport).toBe(true);
    expect(listBlogItemDescriptors().map((item) => item.kindKey)).toEqual(expect.arrayContaining(['media.audio', 'core.translation', 'core.export', 'core.ai_highlight']));
  });
});
