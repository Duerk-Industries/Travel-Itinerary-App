export {};

declare global {
  namespace Express {
    interface User {
      userId?: string;
      email?: string | null;
      provider?: 'google' | 'apple' | 'email';
      googleId?: string;
      name?: string | null;
      photo?: string | null;
    }
  }
}
