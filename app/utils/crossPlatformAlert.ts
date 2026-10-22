import { Alert, Platform } from 'react-native';

// react-native-web's Alert.alert is a literal no-op (`alert() {}`) — it never shows anything on
// web, so every `Alert.alert(title, message)` call in a web build silently swallows its own
// error. This wraps Alert.alert with a web fallback to window.alert so the message actually
// reaches the user there, while native (iOS/Android) keeps using the real native Alert unchanged.
// Only covers the simple title+message case (no buttons/callbacks) — every existing call site in
// this codebase uses that shape; a call needing custom buttons should keep using Alert.alert
// directly and take on the same web-visibility gap deliberately.
export const alertMessage = (title: string, message?: string): void => {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  Alert.alert(title, message);
};

type AlertButton = { text?: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: (value?: string) => void };

let webAlertInstalled = false;

/**
 * Replaces react-native-web's no-op `Alert.alert` with browser dialogs, once, for the whole web app.
 * Without it, every `Alert.alert(...)` in a web build shows nothing, so a failed validation on a Save
 * button looks like a dead button, and a confirmation's callback never runs.
 *
 * One or no button: a plain alert, then that button's callback. Two or more: a confirm dialog; OK runs the
 * first non-cancel button, Cancel runs the cancel button. Native builds keep the real Alert untouched.
 */
export const installWebAlert = (): void => {
  if (Platform.OS !== 'web' || webAlertInstalled || typeof window === 'undefined') return;
  webAlertInstalled = true;
  (Alert as unknown as { alert: (title: string, message?: string, buttons?: AlertButton[]) => void }).alert = (title, message, buttons) => {
    const text = message ? `${title}\n\n${message}` : title;
    const list = Array.isArray(buttons) ? buttons : [];
    if (list.length <= 1) {
      window.alert(text);
      list[0]?.onPress?.();
      return;
    }
    const cancel = list.find((button) => button.style === 'cancel');
    const action = list.find((button) => button !== cancel);
    if (window.confirm(text)) action?.onPress?.();
    else cancel?.onPress?.();
  };
};

/** @internal tests only */
export const __resetWebAlertForTests = (): void => { webAlertInstalled = false; };
