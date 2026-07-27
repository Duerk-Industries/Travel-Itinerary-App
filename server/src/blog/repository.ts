import { getCurrentDbProvider } from '../db';
import * as firebase from './firebaseRepository';
import * as postgres from './postgresRepository';
import * as postgresMedia from './postgresMediaRepository';
import * as firebaseMedia from './firebaseMediaRepository';

export const blogRepository = (): typeof postgres => getCurrentDbProvider() === 'firebase' ? (firebase as unknown as typeof postgres) : postgres;
export const blogMediaRepository = (): typeof postgresMedia => getCurrentDbProvider() === 'firebase' ? (firebaseMedia as unknown as typeof postgresMedia) : postgresMedia;
