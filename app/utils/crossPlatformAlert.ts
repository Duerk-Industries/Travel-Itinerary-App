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
