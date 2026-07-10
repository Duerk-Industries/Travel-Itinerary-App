import crypto from 'crypto';
import { getEnvValue } from '../../env';

export const anonymizeUserId = (userId: string): string => {
  const salt = getEnvValue('AI_HASH_SALT', { defaultValue: '' }) ?? '';
  return crypto.createHash('sha256').update(`${userId}${salt}`).digest('hex');
};
