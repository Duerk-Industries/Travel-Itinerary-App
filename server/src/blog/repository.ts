import { getCurrentDbProvider } from '../db';
import * as firebase from './firebaseRepository';
import * as postgres from './postgresRepository';
import * as postgresMedia from './postgresMediaRepository';
import * as firebaseMedia from './firebaseMediaRepository';

export interface BlogRepository {
  getBlog: typeof postgres.getBlog;
  getBlogCapabilities: typeof postgres.getBlogCapabilities;
  createBlogTextItem: typeof postgres.createBlogTextItem;
  updateBlogTextItem: typeof postgres.updateBlogTextItem;
  deleteBlogItem: typeof postgres.deleteBlogItem;
  reorderBlogItems: typeof postgres.reorderBlogItems;
  getPublicPath: (tripId: string) => Promise<string | null>;
  isBlogPublic: (tripId: string) => Promise<boolean>;
  createModalityItem: (userId: string, tripId: string, kindKey: string, schemaVersion: number, audience: string, payload: any, dayDate: string) => Promise<{ itemId: string; payload: any }>;
  searchBlog: (tripId: string, query: string) => Promise<any[]>;
}

export const blogRepository = (): BlogRepository => getCurrentDbProvider() === 'firebase' ? (firebase as unknown as BlogRepository) : (postgres as unknown as BlogRepository);
export const blogMediaRepository = (): typeof postgresMedia => getCurrentDbProvider() === 'firebase' ? (firebaseMedia as unknown as typeof postgresMedia) : postgresMedia;
