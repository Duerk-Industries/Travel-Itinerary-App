export const DEFAULT_PERMISSION_DENIED_MESSAGE = "You don't have sufficient permissions to perform this action.";

type Listener = (message: string) => void;

let listeners: Listener[] = [];

export const subscribePermissionDenied = (listener: Listener): (() => void) => {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
};

export const notifyPermissionDenied = (message?: string | null): void => {
  const text = message && message.trim() ? message : DEFAULT_PERMISSION_DENIED_MESSAGE;
  listeners.forEach((listener) => listener(text));
};
