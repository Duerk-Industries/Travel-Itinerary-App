import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { AppTheme } from '../../../theme/theme';
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
}> = ({ theme, captures, captureQuery, anonymousUserIdQuery, saving, setCaptureQuery, setAnonymousUserIdQuery, onSearch }) => (
  <View style={[aiOpsStyles.card, cardStyle(theme)]}>
    <Text style={[aiOpsStyles.cardTitle, { color: theme.colors.text }]}>Capture Browser</Text>
    <View style={aiOpsStyles.row}>
      <TextInput style={[aiOpsStyles.input, inputStyle(theme), { flex: 1 }]} value={captureQuery} onChangeText={setCaptureQuery} placeholder="Capture ID" placeholderTextColor={theme.colors.textMuted} />
      <TextInput style={[aiOpsStyles.input, inputStyle(theme), { flex: 1 }]} value={anonymousUserIdQuery} onChangeText={setAnonymousUserIdQuery} placeholder="Anonymous user ID" placeholderTextColor={theme.colors.textMuted} />
      <TouchableOpacity style={[aiOpsStyles.button, { backgroundColor: theme.colors.cta }, saving === 'capture-search' && aiOpsStyles.disabled]} disabled={saving === 'capture-search'} onPress={onSearch}>
        <Text style={aiOpsStyles.buttonText}>Search</Text>
      </TouchableOpacity>
    </View>
    {captures.map((capture) => (
      <View key={`${capture.captureId}-${capture.capturedAt}`} style={aiOpsStyles.compactRow}>
        <Text style={[aiOpsStyles.cardTitle, { color: theme.colors.text }]}>{capture.captureId}</Text>
        <Text style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>
          {capture.featureKey} - {capture.outcome} - {capture.provider ?? 'unknown'} / {capture.model ?? 'unknown'} - {new Date(capture.capturedAt).toLocaleString()}
          {capture.anonymousUserId ? ` - user:${capture.anonymousUserId}` : ''}
        </Text>
      </View>
    ))}
  </View>
);
