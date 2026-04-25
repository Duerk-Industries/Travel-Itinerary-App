import axios, { type AxiosResponse } from 'axios';
import { reserveApiUsageOrThrow } from './usageLimiter';

type UnsplashSearchResponse = {
  results?: Array<{
    urls?: {
      regular?: string;
    };
  }>;
};

type UnsplashRandomResponse = {
  urls?: {
    regular?: string;
  };
};

export const searchUnsplashPhotos = async (params: {
  caller: string;
  accessKey: string;
  query: string;
  perPage?: number;
  orientation?: 'landscape' | 'portrait' | 'squarish';
  timeoutMs?: number;
}): Promise<UnsplashSearchResponse> => {
  await reserveApiUsageOrThrow({ provider: 'UNSPLASH', caller: params.caller });
  const url =
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(params.query)}` +
    `&per_page=${params.perPage ?? 1}&orientation=${params.orientation ?? 'landscape'}`;
  const response = await axios.get<UnsplashSearchResponse>(url, {
    headers: { Authorization: `Client-ID ${params.accessKey}` },
    timeout: params.timeoutMs,
  });
  return response.data;
};

export const getUnsplashRandomPhoto = async (params: {
  caller: string;
  accessKey: string;
  timeoutMs?: number;
  validateStatus?: (status: number) => boolean;
}): Promise<AxiosResponse<UnsplashRandomResponse>> => {
  await reserveApiUsageOrThrow({ provider: 'UNSPLASH', caller: params.caller });
  return axios.get<UnsplashRandomResponse>(
    'https://api.unsplash.com/photos/random?orientation=landscape&content_filter=high&query=travel',
    {
      headers: { Authorization: `Client-ID ${params.accessKey}` },
      timeout: params.timeoutMs,
      validateStatus: params.validateStatus,
    }
  );
};

