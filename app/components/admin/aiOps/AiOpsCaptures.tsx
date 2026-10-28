import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../../../theme/theme';

import { useAppTheme as useStyleTheme } from '../../../theme/ThemeContext';
import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import { aiOpsStyles, cardStyle, inputStyle } from './shared';
import type { AiCaptureItem } from './types';

export const AiOpsCaptures: React.FC<{
  theme: AppTheme;
  captures: AiCaptureItem[];
  captureQuery: string;
  anonymousUserIdQuery: string;
  saving: string | null;
  setCaptureQuery: (value: string) => void;
  setAnonymousUserIdQuery: (value: string) => void;
  onSearch: () => void;
}> = ({ theme: _providedTheme, captures, captureQuery, anonymousUserIdQuery, saving, setCaptureQuery, setAnonymousUserIdQuery, onSearch }) => { const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme); return ((
  <View style={[aiOpsStyles((theme ?? _styleTheme)).card, cardStyle(theme)]}>
    <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardTitle, themeStyle('components_admin_aiOps_AiOpsCaptures_1', { theme: theme }, (theme ?? _styleTheme))]}>Capture Browser</Text>
    <View style={aiOpsStyles((theme ?? _styleTheme)).row}>
      <TextInput style={[aiOpsStyles((theme ?? _styleTheme)).input, inputStyle(theme), themeStyle('components_admin_aiOps_AiOpsCaptures_2', {  }, (theme ?? _styleTheme))]} value={captureQuery} onChangeText={setCaptureQuery} placeholder="Capture ID" placeholderTextColor={theme.colors.textMuted} />
      <TextInput style={[aiOpsStyles((theme ?? _styleTheme)).input, inputStyle(theme), themeStyle('components_admin_aiOps_AiOpsCaptures_3', {  }, (theme ?? _styleTheme))]} value={anonymousUserIdQuery} onChangeText={setAnonymousUserIdQuery} placeholder="Anonymous user ID" placeholderTextColor={theme.colors.textMuted} />
      <TouchableOpacity style={[aiOpsStyles((theme ?? _styleTheme)).button, themeStyle('components_admin_aiOps_AiOpsCaptures_4', { theme: theme }, (theme ?? _styleTheme)), saving === 'capture-search' && aiOpsStyles((theme ?? _styleTheme)).disabled]} disabled={saving === 'capture-search'} onPress={onSearch}>
        <Text style={[aiOpsStyles((theme ?? _styleTheme)).buttonText, themeStyle('ctaLabel', {}, (theme ?? _styleTheme))]}>Search</Text>
      </TouchableOpacity>
    </View>
    {captures.map((capture) => (
      <View key={`${capture.captureId}-${capture.capturedAt}`} style={aiOpsStyles((theme ?? _styleTheme)).compactRow}>
        <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardTitle, themeStyle('components_admin_aiOps_AiOpsCaptures_5', { theme: theme }, (theme ?? _styleTheme))]}>{capture.captureId}</Text>
        <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardSub, themeStyle('components_admin_aiOps_AiOpsCaptures_6', { theme: theme }, (theme ?? _styleTheme))]}>
          {capture.featureKey} - {capture.outcome} - {capture.provider ?? 'unknown'} / {capture.model ?? 'unknown'} - {new Date(capture.capturedAt).toLocaleString()}
          {capture.anonymousUserId ? ` - user:${capture.anonymousUserId}` : ''}
        </Text>
      </View>
    ))}
  </View>
)); };
