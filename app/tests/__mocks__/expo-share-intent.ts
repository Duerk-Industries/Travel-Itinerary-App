export const useShareIntent = jest.fn(() => ({
  isReady: true,
  hasShareIntent: false,
  shareIntent: { files: null, text: null, type: null, webUrl: null, meta: null },
  resetShareIntent: jest.fn(),
  error: null,
}));

export const ShareIntentProvider = ({ children }: { children: unknown }) => children;
export const useShareIntentContext = useShareIntent;
