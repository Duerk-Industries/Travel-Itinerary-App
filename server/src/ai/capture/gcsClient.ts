import { Storage } from '@google-cloud/storage';
import { getEnvValue } from '../../env';

let storage: Storage | null = null;

export type AiCaptureGcsTarget = {
  bucketName: string;
  objectPrefix: string;
};

export const getAiCaptureGcsTarget = (): AiCaptureGcsTarget => {
  const explicitBucket = getEnvValue('AI_CAPTURE_BUCKET');
  if (explicitBucket) {
    return { bucketName: explicitBucket, objectPrefix: '' };
  }
  const fallbackBucket =
    getEnvValue('LOCATION_BUCKET') ??
    'duerk-travel-itinerary-app-location-data';
  return { bucketName: fallbackBucket, objectPrefix: 'ai-capture/' };
};

export const getAiCaptureBucket = () => {
  storage ??= new Storage();
  return storage.bucket(getAiCaptureGcsTarget().bucketName);
};

export const clearAiCaptureGcsClientForTesting = (): void => {
  storage = null;
};
