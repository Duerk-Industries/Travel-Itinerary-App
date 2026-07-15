import { Platform } from 'react-native';
import { createNavigationContainerRef, type LinkingOptions } from '@react-navigation/native';
import type { AiOpsSection } from './tabs/AdminTab';

export type AdminSectionRoute = 'overview' | 'users' | 'tiers' | 'features' | 'ai-ops' | 'user-data' | 'audit-log' | 'ingestion' | 'api-limits' | 'billing';
export type AiOpsSectionRoute = AiOpsSection;

export type RootStackParamList = {
  Main: undefined;
  AdminOverview: undefined;
  AdminUsers: undefined;
  AdminTiers: undefined;
  AdminFeatures: undefined;
  AdminUserData: undefined;
  AdminAuditLog: undefined;
  AdminBilling: undefined;
  AdminAiOpsOverview: undefined;
  AdminAiOpsProviders: undefined;
  AdminAiOpsExperiments: undefined;
  AdminAiOpsRecommendations: undefined;
  AdminAiOpsCaptures: undefined;
  AdminAiOpsParserQuality: undefined;
  AdminAiOpsShadowReplay: undefined;
  AdminAiOpsExecutive: undefined;
  AdminAiOpsRuntimeSettings: undefined;
  AdminAiOpsItineraryInstructions: undefined;
  AdminAiOpsAiAuditLog: undefined;
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export const adminScreenBySection: Partial<Record<AdminSectionRoute, keyof RootStackParamList>> = {
  overview: 'AdminOverview',
  users: 'AdminUsers',
  tiers: 'AdminTiers',
  features: 'AdminFeatures',
  'user-data': 'AdminUserData',
  'audit-log': 'AdminAuditLog',
  billing: 'AdminBilling',
  'ai-ops': 'AdminAiOpsOverview',
  // 'ingestion' and 'api-limits' are handled internally by AdminTab, no separate screen needed
};

export const aiOpsScreenBySection: Record<AiOpsSectionRoute, keyof RootStackParamList> = {
  overview: 'AdminAiOpsOverview',
  providers: 'AdminAiOpsProviders',
  experiments: 'AdminAiOpsExperiments',
  recommendations: 'AdminAiOpsRecommendations',
  captures: 'AdminAiOpsCaptures',
  'parser-quality': 'AdminAiOpsParserQuality',
  'shadow-replay': 'AdminAiOpsShadowReplay',
  executive: 'AdminAiOpsExecutive',
  'runtime-settings': 'AdminAiOpsRuntimeSettings',
  'itinerary-instructions': 'AdminAiOpsItineraryInstructions',
  'ai-audit-log': 'AdminAiOpsAiAuditLog',
};

export const adminSectionByScreen: Partial<Record<Exclude<keyof RootStackParamList, 'Main'>, AdminSectionRoute>> = {
  AdminOverview: 'overview',
  AdminUsers: 'users',
  AdminTiers: 'tiers',
  AdminFeatures: 'features',
  AdminUserData: 'user-data',
  AdminAuditLog: 'audit-log',
  AdminBilling: 'billing',
  AdminAiOpsOverview: 'overview',
};

// IMPORTANT: this scheme MUST match `expo.scheme` in app.json, otherwise
// React Navigation builds deep-link URLs that don't open the installed app.
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [
    'travelitineraryplanner://',
    ...(Platform.OS === 'web' && typeof window !== 'undefined' ? [window.location.origin] : []),
  ],
  config: {
    screens: {
      Main: '',
      AdminOverview: 'admin',
      AdminUsers: 'admin/users',
      AdminTiers: 'admin/tiers',
      AdminFeatures: 'admin/features',
      AdminUserData: 'admin/user-data',
      AdminAuditLog: 'admin/audit-log',
      AdminBilling: 'admin/billing',
      AdminAiOpsOverview: 'admin/ai-ops',
      AdminAiOpsProviders: 'admin/ai-ops/providers',
      AdminAiOpsExperiments: 'admin/ai-ops/experiments',
      AdminAiOpsRecommendations: 'admin/ai-ops/recommendations',
      AdminAiOpsCaptures: 'admin/ai-ops/captures',
      AdminAiOpsParserQuality: 'admin/ai-ops/parser-quality',
      AdminAiOpsShadowReplay: 'admin/ai-ops/shadow-replay',
      AdminAiOpsExecutive: 'admin/ai-ops/executive',
      AdminAiOpsRuntimeSettings: 'admin/ai-ops/runtime-settings',
      AdminAiOpsItineraryInstructions: 'admin/ai-ops/itinerary-instructions',
      AdminAiOpsAiAuditLog: 'admin/ai-ops/ai-audit-log',
    },
  },
};
