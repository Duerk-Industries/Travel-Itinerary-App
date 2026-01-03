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
    bundleIdentifier: 'com.duerkindustries.travelitineraryplanner',
    infoPlist: {
      "ITSAppUsesNonExemptEncryption": false,
      // Allow plain HTTP calls to the local backend while developing on LAN.
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: true,
        NSExceptionDomains: {
          '192.168.50.200': {
            NSIncludesSubdomains: true,
            NSExceptionAllowsInsecureHTTPLoads: true,
          },
        },
      },
    }
  },
  android: {
    // Android appId must avoid hyphens; use a dot/alpha-only identifier.
    package: 'com.duerkindustries.travelitineraryplanner'
  },
  extra: {
    backendUrl: process.env.BACKEND_URL || 'http://192.168.50.200:4000',
    eas: {
        projectId: "06966c0b-d878-4346-850c-090c762f1916"
    }
  }
};

export default config;
