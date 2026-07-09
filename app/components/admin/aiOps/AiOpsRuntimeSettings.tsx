import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { AppTheme } from '../../../theme/theme';
import { aiOpsStyles, cardStyle, inputStyle } from './shared';
import type { AiRuntimeSetting } from './types';

export const AiOpsRuntimeSettings: React.FC<{
  theme: AppTheme;
  settings: AiRuntimeSetting[];
  drafts: Record<string, string>;
  reason: string;
  saving: string | null;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setReason: (reason: string) => void;
  onSave: () => void;
}> = ({ theme, settings, drafts, reason, saving, setDrafts, setReason, onSave }) => (
  <View style={[aiOpsStyles.card, cardStyle(theme)]}>
    <Text style={[aiOpsStyles.cardTitle, { color: theme.colors.text }]}>Runtime Settings</Text>
    {settings.map((setting) => (
      <View key={setting.key} style={aiOpsStyles.row}>
        <View style={{ minWidth: 220, flex: 1 }}>
          <Text style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>{setting.key}</Text>
          <Text style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>{setting.updatedAt ? new Date(setting.updatedAt).toLocaleString() : 'default'}</Text>
        </View>
        <TextInput
          style={[aiOpsStyles.input, inputStyle(theme), { flex: 1 }]}
          value={drafts[setting.key] ?? setting.value}
          keyboardType="numeric"
          onChangeText={(value) => setDrafts((prev) => ({ ...prev, [setting.key]: value }))}
        />
      </View>
    ))}
    <TextInput
      style={[aiOpsStyles.input, inputStyle(theme)]}
      value={reason}
      onChangeText={setReason}
      placeholder="Reason for audit log"
      placeholderTextColor={theme.colors.textMuted}
    />
    <TouchableOpacity
      style={[aiOpsStyles.button, { backgroundColor: theme.colors.cta }, saving === 'runtime-settings' && aiOpsStyles.disabled]}
      disabled={saving === 'runtime-settings'}
      onPress={onSave}
    >
      <Text style={aiOpsStyles.buttonText}>{saving === 'runtime-settings' ? 'Saving...' : 'Save settings'}</Text>
    </TouchableOpacity>
  </View>
);
