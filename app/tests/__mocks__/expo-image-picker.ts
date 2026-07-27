export const MediaTypeOptions = {
  Images: 'Images',
};

export const requestMediaLibraryPermissionsAsync = jest.fn(async () => ({
  granted: false,
  status: 'denied',
}));

export const launchImageLibraryAsync = jest.fn(async () => ({
  canceled: true,
  assets: null,
}));
