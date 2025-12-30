import { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Travel Itinerary Planner',
  slug: 'travel-itinerary-planner',
  scheme: 'travelitineraryplanner',
  owner: 'duerk-industries',
  web: {
    bundler: 'metro'
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.duerk-industries.travelitineraryplanner',
    infoPlist: {
      "ITSAppUsesNonExemptEncryption": false
    }
  },
  android: {
    package: 'com.duerk-industries.travelitineraryplanner'
  },
  extra: {
    backendUrl: process.env.BACKEND_URL || 'http://localhost:4000',
    eas: {
        projectId: "06966c0b-d878-4346-850c-090c762f1916"
    }
  }
};

export default config;
