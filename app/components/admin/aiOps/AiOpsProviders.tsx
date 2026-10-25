import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../../../theme/theme';

import { useAppTheme as useStyleTheme } from '../../../theme/ThemeContext';
import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import { aiOpsStyles, cardStyle, inputStyle } from './shared';
import type { AiProviderCertification, AiProviderFeatureConfig, AiProviderOption } from './types';

export const AiOpsProviders: React.FC<{
  theme: AppTheme;
  features: AiProviderFeatureConfig[];
  providers: AiProviderOption[];
  certifications: AiProviderCertification[];
  certificationVersion: string;
  certificationReason: string;
  drafts: Record<string, AiProviderFeatureConfig>;
  reasons: Record<string, string>;
  saving: string | null;
  setCertificationVersion: (value: string) => void;
  setCertificationReason: (value: string) => void;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, AiProviderFeatureConfig>>>;
  setReasons: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onSave: (featureKey: string) => void;
  onCertify: (providerId: string, revoke?: boolean) => void;
}> = ({ theme: _providedTheme, features, providers, certifications, certificationVersion, certificationReason, drafts, reasons, saving, setCertificationVersion, setCertificationReason, setDrafts, setReasons, onSave, onCertify }) => { const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme); return ((
  <>
    <View style={[aiOpsStyles((theme ?? _styleTheme)).card, cardStyle(theme)]}>
      <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardTitle, themeStyle('components_admin_aiOps_AiOpsProviders_1', { theme: theme }, (theme ?? _styleTheme))]}>Provider Certification</Text>
      <TextInput
        style={[aiOpsStyles((theme ?? _styleTheme)).input, inputStyle(theme)]}
        value={certificationVersion}
        onChangeText={setCertificationVersion}
        placeholder="Contract suite version or git SHA"
        placeholderTextColor={theme.colors.textMuted}
      />
      <TextInput
        style={[aiOpsStyles((theme ?? _styleTheme)).input, inputStyle(theme)]}
        value={certificationReason}
        onChangeText={setCertificationReason}
        placeholder="Reason for audit log"
        placeholderTextColor={theme.colors.textMuted}
      />
      {providers.map((provider) => {
        const certification = certifications.find((item) => item.providerId === provider.id);
        const unavailable = !provider.registered;
        return (
          <View key={provider.id} style={aiOpsStyles((theme ?? _styleTheme)).compactRow}>
            <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardTitle, themeStyle('components_admin_aiOps_AiOpsProviders_2', { theme: theme }, (theme ?? _styleTheme))]}>{provider.id}</Text>
            <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardSub, themeStyle('components_admin_aiOps_AiOpsProviders_3', { theme: theme }, (theme ?? _styleTheme))]}>
              {provider.registered ? 'registered' : 'not registered'} - {provider.configured ? 'configured' : 'not configured'}
              {certification ? ` - certified ${certification.contractSuiteVersion}` : ' - not certified'}
            </Text>
            <View style={aiOpsStyles((theme ?? _styleTheme)).rowWrap}>
              <TouchableOpacity
                style={[aiOpsStyles((theme ?? _styleTheme)).button, themeStyle('components_admin_aiOps_AiOpsProviders_4', { theme: theme }, (theme ?? _styleTheme)), (saving === `certify-${provider.id}` || unavailable) && aiOpsStyles((theme ?? _styleTheme)).disabled]}
                disabled={saving === `certify-${provider.id}` || unavailable}
                onPress={() => onCertify(provider.id)}
              >
                <Text style={aiOpsStyles((theme ?? _styleTheme)).buttonText}>{certification ? 'Re-certify' : 'Certify'}</Text>
              </TouchableOpacity>
              {certification ? (
                <TouchableOpacity
                  style={[aiOpsStyles((theme ?? _styleTheme)).button, themeStyle('components_admin_aiOps_AiOpsProviders_5', { theme: theme }, (theme ?? _styleTheme)), saving === `certify-${provider.id}` && aiOpsStyles((theme ?? _styleTheme)).disabled]}
                  disabled={saving === `certify-${provider.id}`}
                  onPress={() => onCertify(provider.id, true)}
                >
                  <Text style={aiOpsStyles((theme ?? _styleTheme)).buttonText}>Revoke</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
    {features.map((feature) => {
      const draft = drafts[feature.featureKey] ?? feature;
      const selectedProvider = providers.find((provider) => provider.id === draft.provider);
      const selectableProviders = providers.filter((provider) => provider.configured && provider.registered);
      return (
        <View key={feature.featureKey} style={[aiOpsStyles((theme ?? _styleTheme)).card, cardStyle(theme)]}>
          <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardTitle, themeStyle('components_admin_aiOps_AiOpsProviders_6', { theme: theme }, (theme ?? _styleTheme))]}>{feature.featureKey}</Text>
          <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardSub, themeStyle('components_admin_aiOps_AiOpsProviders_7', { theme: theme }, (theme ?? _styleTheme))]}>
            Last changed {feature.updatedAt ? new Date(feature.updatedAt).toLocaleString() : 'never'}
            {feature.updatedBy ? ` by ${feature.updatedBy}` : ''}
          </Text>
          <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardSub, themeStyle('components_admin_aiOps_AiOpsProviders_8', { theme: theme }, (theme ?? _styleTheme))]}>Provider</Text>
          <View style={aiOpsStyles((theme ?? _styleTheme)).rowWrap}>
            {providers.map((provider) => {
              const unavailable = !provider.configured || !provider.registered;
              const active = draft.provider === provider.id;
              return (
                <TouchableOpacity
                  key={provider.id}
                  disabled={unavailable}
                  style={[
                    aiOpsStyles((theme ?? _styleTheme)).navButton,
                    active && aiOpsStyles((theme ?? _styleTheme)).navButtonActive,
                    unavailable && aiOpsStyles((theme ?? _styleTheme)).disabled,
                    themeStyle('components_admin_aiOps_AiOpsProviders_9', { theme: theme }, (theme ?? _styleTheme)),
                  ]}
                  onPress={() => setDrafts((prev) => ({
                    ...prev,
                    [feature.featureKey]: { ...draft, provider: provider.id, model: provider.supportedModels[0] ?? draft.model },
                  }))}
                >
                  <Text style={[aiOpsStyles((theme ?? _styleTheme)).navText, themeStyle('components_admin_aiOps_AiOpsProviders_10', { theme: theme }, (theme ?? _styleTheme)), active && aiOpsStyles((theme ?? _styleTheme)).navTextActive]}>
                    {provider.id}{provider.certified ? ' certified' : ''}{unavailable ? ' unavailable' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {selectedProvider?.supportedModels?.length ? (
            <>
              <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardSub, themeStyle('components_admin_aiOps_AiOpsProviders_11', { theme: theme }, (theme ?? _styleTheme))]}>Suggested models</Text>
              <View style={aiOpsStyles((theme ?? _styleTheme)).rowWrap}>
                {selectedProvider.supportedModels.map((modelId) => {
                  const active = draft.model === modelId;
                  return (
                    <TouchableOpacity
                      key={`${feature.featureKey}-${selectedProvider.id}-${modelId}`}
                      style={[
                        aiOpsStyles((theme ?? _styleTheme)).navButton,
                        active && aiOpsStyles((theme ?? _styleTheme)).navButtonActive,
                        themeStyle('components_admin_aiOps_AiOpsProviders_12', { theme: theme }, (theme ?? _styleTheme)),
                      ]}
                      onPress={() => setDrafts((prev) => ({
                        ...prev,
                        [feature.featureKey]: { ...draft, model: modelId },
                      }))}
                    >
                      <Text style={[aiOpsStyles((theme ?? _styleTheme)).navText, themeStyle('components_admin_aiOps_AiOpsProviders_13', { theme: theme }, (theme ?? _styleTheme)), active && aiOpsStyles((theme ?? _styleTheme)).navTextActive]}>
                        {modelId}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          ) : null}
          <TextInput
            style={[aiOpsStyles((theme ?? _styleTheme)).input, inputStyle(theme)]}
            value={draft.model}
            onChangeText={(model) => setDrafts((prev) => ({ ...prev, [feature.featureKey]: { ...draft, model } }))}
            placeholder="Model id"
            placeholderTextColor={theme.colors.textMuted}
            editable={Boolean(selectedProvider?.configured && selectedProvider?.registered)}
          />
          <TouchableOpacity
            style={[aiOpsStyles((theme ?? _styleTheme)).button, themeStyle('components_admin_aiOps_AiOpsProviders_14', { draft: draft, theme: theme }, (theme ?? _styleTheme))]}
            onPress={() => setDrafts((prev) => ({ ...prev, [feature.featureKey]: { ...draft, enabled: !draft.enabled } }))}
          >
            <Text style={aiOpsStyles((theme ?? _styleTheme)).buttonText}>{draft.enabled ? 'Enabled' : 'Disabled'}</Text>
          </TouchableOpacity>
          <TextInput
            style={[aiOpsStyles((theme ?? _styleTheme)).input, inputStyle(theme)]}
            value={reasons[feature.featureKey] ?? ''}
            onChangeText={(value) => setReasons((prev) => ({ ...prev, [feature.featureKey]: value }))}
            placeholder="Reason for audit log"
            placeholderTextColor={theme.colors.textMuted}
          />
          <TouchableOpacity
            style={[
              aiOpsStyles((theme ?? _styleTheme)).button,
              themeStyle('components_admin_aiOps_AiOpsProviders_15', { theme: theme }, (theme ?? _styleTheme)),
              (saving === feature.featureKey || selectableProviders.length === 0) && aiOpsStyles((theme ?? _styleTheme)).disabled,
            ]}
            disabled={saving === feature.featureKey || selectableProviders.length === 0}
            onPress={() => onSave(feature.featureKey)}
          >
            <Text style={aiOpsStyles((theme ?? _styleTheme)).buttonText}>{saving === feature.featureKey ? 'Saving...' : 'Save config'}</Text>
          </TouchableOpacity>
        </View>
      );
    })}
  </>
)); };
