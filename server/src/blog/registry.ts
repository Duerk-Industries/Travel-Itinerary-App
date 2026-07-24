import { BlogItemKind, BlogItemTypeDescriptor } from './types';

const descriptors: BlogItemTypeDescriptor[] = [
  { kindKey: 'core.text', schemaVersion: 1, featureFlag: 'trip_blog', defaultAudience: 'public', supportsPublic: true, supportsExport: true },
  { kindKey: 'media.photo', schemaVersion: 1, featureFlag: 'trip_blog_photo_uploads', defaultAudience: 'public', supportsPublic: true, supportsExport: true, maxBytes: 20 * 1024 * 1024 },
  { kindKey: 'media.video', schemaVersion: 1, featureFlag: 'trip_blog_video_uploads', defaultAudience: 'public', supportsPublic: true, supportsExport: true, maxBytes: 1024 * 1024 * 1024 },
  { kindKey: 'media.audio', schemaVersion: 1, featureFlag: 'trip_blog_audio', defaultAudience: 'public', supportsPublic: true, supportsExport: true },
  { kindKey: 'media.panorama', schemaVersion: 1, featureFlag: 'trip_blog_panorama_media', defaultAudience: 'public', supportsPublic: true, supportsExport: true },
  { kindKey: 'core.gallery', schemaVersion: 1, featureFlag: 'trip_blog_galleries', defaultAudience: 'public', supportsPublic: true, supportsExport: true },
  { kindKey: 'core.structured_card', schemaVersion: 1, featureFlag: 'trip_blog_structured_cards', defaultAudience: 'public', supportsPublic: true, supportsExport: true },
  { kindKey: 'core.translation', schemaVersion: 1, featureFlag: 'trip_blog_translation', defaultAudience: 'followers', supportsPublic: true, supportsExport: true },
  { kindKey: 'core.export', schemaVersion: 1, featureFlag: 'trip_blog_exports', defaultAudience: 'travelers', supportsPublic: false, supportsExport: true },
  { kindKey: 'core.ai_highlight', schemaVersion: 1, featureFlag: 'trip_blog_ai_highlights', defaultAudience: 'travelers', supportsPublic: true, supportsExport: true },
];

export const listBlogItemDescriptors = (): BlogItemTypeDescriptor[] => descriptors.map((item) => ({ ...item }));

export const getBlogItemDescriptor = (kindKey: string): BlogItemTypeDescriptor | null =>
  descriptors.find((item) => item.kindKey === kindKey) ?? null;

export const isBlogItemKind = (value: unknown): value is BlogItemKind => Boolean(getBlogItemDescriptor(String(value ?? '')));
