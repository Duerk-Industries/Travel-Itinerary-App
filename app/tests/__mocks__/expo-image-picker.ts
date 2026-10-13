export const MediaTypeOptions = {
  Images: 'Images',
};

export const UIImagePickerPreferredAssetRepresentationMode = {
  Compatible: 'compatible',
  Current: 'current',
};

export const requestMediaLibraryPermissionsAsync = jest.fn(async () => ({
  granted: false,
  status: 'denied',
}));

export const launchImageLibraryAsync = jest.fn(async () => ({
  canceled: true,
  assets: null,
}));

export const requestCameraPermissionsAsync = jest.fn(async () => ({
  granted: false,
  status: 'denied',
}));

export const launchCameraAsync = jest.fn(async () => ({
  canceled: true,
  assets: null,
}));
