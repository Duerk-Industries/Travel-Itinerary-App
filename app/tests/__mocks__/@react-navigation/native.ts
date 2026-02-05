export const useNavigation = () => ({
  navigate: jest.fn(),
  goBack: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
  setOptions: jest.fn(),
});

export const useRoute = () => ({
  params: {},
});

export const useFocusEffect = (callback: () => void) => {
  callback();
};

export const useIsFocused = () => true;

export const NavigationContainer = ({ children }: { children: any }) => children as any;
