// The server answers 403 with this code for any request from an account that hasn't declared a
// date of birth yet (server/src/auth.ts). That isn't a permissions problem: the right response is
// to show the date-of-birth prompt, not the generic "Permission Denied" popup or a sign-out.
export const AGE_VERIFICATION_REQUIRED_CODE = 'AGE_VERIFICATION_REQUIRED';

type Listener = () => void;

let listeners: Listener[] = [];

export const subscribeAgeVerificationRequired = (listener: Listener): (() => void) => {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
};

export const notifyAgeVerificationRequired = (): void => {
  listeners.forEach((listener) => listener());
};

export const isAgeVerificationRequiredBody = (data: unknown): boolean =>
  Boolean(data && typeof data === 'object' && (data as { code?: unknown }).code === AGE_VERIFICATION_REQUIRED_CODE);
