export const Platform = { OS: 'web' };
export const ScrollView = 'ScrollView';
export const Text = 'Text';
export const TextInput = 'TextInput';
export const TouchableOpacity = 'TouchableOpacity';
export const View = 'View';
export const Image = 'Image';
export const AsyncStorage = {
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
};
export const StyleSheet = { create: <T extends Record<string, any>>(styles: T) => styles };

export default {
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image,
  AsyncStorage,
  StyleSheet,
};
