import { getCurrentDbProvider } from '../db';
import * as postgres from './postgresRecapRepository';
import * as firebase from './firebaseRecapRepository';

export type BlogRecapRepository = typeof postgres;

export const blogRecapRepository = (): BlogRecapRepository =>
  getCurrentDbProvider() === 'firebase' ? (firebase as unknown as BlogRecapRepository) : postgres;
