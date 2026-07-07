import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { AppTheme } from '../../../theme/theme';
import { aiOpsStyles, cardStyle, inputStyle } from './shared';
import type { AiProviderFeatureConfig, AiProviderOption } from './types';

export const AiOpsProviders: React.FC<{
  theme: AppTheme;
  features: AiProviderFeatureConfig[];
  providers: AiProviderOption[];
  drafts: Record<string, AiProviderFeatureConfig>;
  reasons: Record<string, string>;
  saving: string | null;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, AiProviderFeatureConfig>>>;
  setReasons: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onSave: (featureKey: string) => void;
}> = ({ theme, features, providers, drafts, reasons, saving, setDrafts, setReasons, onSave }) => (
  <>
    {features.map((feature) => {
      const draft = drafts[feature.featureKey] ?? feature;
      const selectedProvider = providers.find((provider) => provider.id === draft.provider);
      const selectableProviders = providers.filter((provider) => provider.configured && provider.registered);
      return (
        <View key={feature.featureKey} style={[aiOpsStyles.card, cardStyle(theme)]}>
          <Text style={[aiOpsStyles.cardTitle, { color: theme.colors.text }]}>{feature.featureKey}</Text>
          <Text style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>
            Last changed {feature.updatedAt ? new Date(feature.updatedAt).toLocaleString() : 'never'}
            {feature.updatedBy ? ` by ${feature.updatedBy}` : ''}
          </Text>
          <Text style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>Provider</Text>
          <View style={aiOpsStyles.rowWrap}>
            {providers.map((provider) => {
              const unavailable = !provider.configured || !provider.registered;
              const active = draft.provider === provider.id;
              return (
                <TouchableOpacity
                  key={provider.id}
                  disabled={unavailable}
                  style={[
                    aiOpsStyles.navButton,
                    active && aiOpsStyles.navButtonActive,
                    unavailable && aiOpsStyles.disabled,
                    { borderColor: theme.colors.border },
                  ]}
                  onPress={() => setDrafts((prev) => ({
                    ...prev,
                    [feature.featureKey]: { ...draft, provider: provider.id, model: provider.supportedModels[0] ?? draft.model },
                  }))}
                >
                  <Text style={[aiOpsStyles.navText, { color: theme.colors.text }, active && aiOpsStyles.navTextActive]}>
                    {provider.id}{provider.certified ? ' certified' : ''}{unavailable ? ' unavailable' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput
            style={[aiOpsStyles.input, inputStyle(theme)]}
            value={draft.model}
            onChangeText={(model) => setDrafts((prev) => ({ ...prev, [feature.featureKey]: { ...draft, model } }))}
            editable={Boolean(selectedProvider?.configured && selectedProvider?.registered)}
          />
          <TouchableOpacity
            style={[aiOpsStyles.button, { backgroundColor: draft.enabled ? theme.colors.success : theme.colors.alert }]}
            onPress={() => setDrafts((prev) => ({ ...prev, [feature.featureKey]: { ...draft, enabled: !draft.enabled } }))}
          >
            <Text style={aiOpsStyles.buttonText}>{draft.enabled ? 'Enabled' : 'Disabled'}</Text>
          </TouchableOpacity>
          <TextInput
            style={[aiOpsStyles.input, inputStyle(theme)]}
            value={reasons[feature.featureKey] ?? ''}
            onChangeText={(value) => setReasons((prev) => ({ ...prev, [feature.featureKey]: value }))}
            placeholder="Reason for audit log"
            placeholderTextColor={theme.colors.textMuted}
          />
          <TouchableOpacity
            style={[
              aiOpsStyles.button,
              { backgroundColor: theme.colors.cta },
              (saving === feature.featureKey || selectableProviders.length === 0) && aiOpsStyles.disabled,
            ]}
            disabled={saving === feature.featureKey || selectableProviders.length === 0}
            onPress={() => onSave(feature.featureKey)}
          >
            <Text style={aiOpsStyles.buttonText}>{saving === feature.featureKey ? 'Saving...' : 'Save config'}</Text>
          </TouchableOpacity>
        </View>
      );
    })}
  </>
);
