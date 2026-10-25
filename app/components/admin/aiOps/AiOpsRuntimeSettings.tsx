import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../../../theme/theme';

import { useAppTheme as useStyleTheme } from '../../../theme/ThemeContext';
import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

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
}> = ({ theme: _providedTheme, settings, drafts, reason, saving, setDrafts, setReason, onSave }) => { const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme); return ((
  <View style={[aiOpsStyles((theme ?? _styleTheme)).card, cardStyle(theme)]}>
    <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardTitle, themeStyle('components_admin_aiOps_AiOpsRuntimeSettings_1', { theme: theme }, (theme ?? _styleTheme))]}>Runtime Settings</Text>
    {settings.map((setting) => (
      <View key={setting.key} style={aiOpsStyles((theme ?? _styleTheme)).row}>
        <View style={themeStyle('components_admin_aiOps_AiOpsRuntimeSettings_2', {  }, (theme ?? _styleTheme))}>
          <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardSub, themeStyle('components_admin_aiOps_AiOpsRuntimeSettings_3', { theme: theme }, (theme ?? _styleTheme))]}>{setting.key}</Text>
          <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardSub, themeStyle('components_admin_aiOps_AiOpsRuntimeSettings_4', { theme: theme }, (theme ?? _styleTheme))]}>{setting.updatedAt ? new Date(setting.updatedAt).toLocaleString() : 'default'}</Text>
        </View>
        <TextInput
          style={[aiOpsStyles((theme ?? _styleTheme)).input, inputStyle(theme), themeStyle('components_admin_aiOps_AiOpsRuntimeSettings_5', {  }, (theme ?? _styleTheme))]}
          value={drafts[setting.key] ?? setting.value}
          keyboardType="numeric"
          onChangeText={(value) => setDrafts((prev) => ({ ...prev, [setting.key]: value }))}
        />
      </View>
    ))}
    <TextInput
      style={[aiOpsStyles((theme ?? _styleTheme)).input, inputStyle(theme)]}
      value={reason}
      onChangeText={setReason}
      placeholder="Reason for audit log"
      placeholderTextColor={theme.colors.textMuted}
    />
    <TouchableOpacity
      style={[aiOpsStyles((theme ?? _styleTheme)).button, themeStyle('components_admin_aiOps_AiOpsRuntimeSettings_6', { theme: theme }, (theme ?? _styleTheme)), saving === 'runtime-settings' && aiOpsStyles((theme ?? _styleTheme)).disabled]}
      disabled={saving === 'runtime-settings'}
      onPress={onSave}
    >
      <Text style={aiOpsStyles((theme ?? _styleTheme)).buttonText}>{saving === 'runtime-settings' ? 'Saving...' : 'Save settings'}</Text>
    </TouchableOpacity>
  </View>
)); };
