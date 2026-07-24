import { getCurrentDbProvider } from '../db';
import * as firebase from './firebaseRepository';
import * as postgres from './postgresRepository';

export const blogRepository = (): typeof postgres => getCurrentDbProvider() === 'firebase' ? (firebase as unknown as typeof postgres) : postgres;
