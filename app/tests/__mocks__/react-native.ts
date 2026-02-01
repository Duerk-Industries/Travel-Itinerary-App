export const Platform = { OS: 'ios' };
export const ScrollView = 'ScrollView';
export const Text = 'Text';
export const TextInput = 'TextInput';
export const TouchableOpacity = 'TouchableOpacity';
export const TouchableWithoutFeedback = 'TouchableWithoutFeedback';
export const TouchableHighlight = 'TouchableHighlight';
export const Pressable = 'Pressable';
export const View = 'View';
export const Image = 'Image';
export const ImageBackground = 'ImageBackground';
export const FlatList = 'FlatList';
export const SectionList = 'SectionList';
export const Switch = 'Switch';
export const Modal = 'Modal';
export const SafeAreaView = 'SafeAreaView';
export const ActivityIndicator = 'ActivityIndicator';
export const AsyncStorage = {
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
};
export const StyleSheet = {
  create: <T extends Record<string, any>>(styles: T) => styles,
  flatten: (style: any) => style,
};
export const useWindowDimensions = () => ({
  width: 800,
  height: 600,
});

export default {
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  TouchableHighlight,
  Pressable,
  View,
  Image,
  ImageBackground,
  FlatList,
  SectionList,
  Switch,
  Modal,
  SafeAreaView,
  ActivityIndicator,
  AsyncStorage,
  StyleSheet,
  useWindowDimensions,
};
