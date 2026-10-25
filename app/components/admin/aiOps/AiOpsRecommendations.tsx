import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../../../theme/theme';

import { useAppTheme as useStyleTheme } from '../../../theme/ThemeContext';
import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import { aiOpsStyles, cardStyle, inputStyle } from './shared';
import type { AiRecommendation } from './types';

export const AiOpsRecommendations: React.FC<{
  theme: AppTheme;
  recommendations: AiRecommendation[];
  reason: string;
  saving: string | null;
  setReason: (value: string) => void;
  onApply: (recommendation: AiRecommendation) => void;
  onDismiss: (recommendation: AiRecommendation) => void;
}> = ({ theme: _providedTheme, recommendations, reason, saving, setReason, onApply, onDismiss }) => { const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme); return ((
  <View style={[aiOpsStyles((theme ?? _styleTheme)).card, cardStyle(theme)]}>
    <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardTitle, themeStyle('components_admin_aiOps_AiOpsRecommendations_1', { theme: theme }, (theme ?? _styleTheme))]}>Recommendations</Text>
    <TextInput
      style={[aiOpsStyles((theme ?? _styleTheme)).input, inputStyle(theme)]}
      value={reason}
      onChangeText={setReason}
      placeholder="Reason for audit log"
      placeholderTextColor={theme.colors.textMuted}
    />
    {recommendations.length === 0 ? <Text style={[aiOpsStyles((theme ?? _styleTheme)).empty, themeStyle('components_admin_aiOps_AiOpsRecommendations_2', { theme: theme }, (theme ?? _styleTheme))]}>No recommendations proposed.</Text> : null}
    {recommendations.map((recommendation) => {
      const busy = saving === `recommendation-${recommendation.recommendationId}`;
      return (
        <View key={recommendation.recommendationId} style={aiOpsStyles((theme ?? _styleTheme)).compactRow}>
          <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardTitle, themeStyle('components_admin_aiOps_AiOpsRecommendations_3', { theme: theme }, (theme ?? _styleTheme))]}>{recommendation.recommendationType}</Text>
          <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardSub, themeStyle('components_admin_aiOps_AiOpsRecommendations_4', { theme: theme }, (theme ?? _styleTheme))]}>
            {recommendation.featureKey} - {recommendation.status} - {recommendation.confidence}
          </Text>
          <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardSub, themeStyle('components_admin_aiOps_AiOpsRecommendations_5', { theme: theme }, (theme ?? _styleTheme))]}>{recommendation.rationale}</Text>
          {recommendation.status === 'proposed' ? (
            <View style={aiOpsStyles((theme ?? _styleTheme)).rowWrap}>
              <TouchableOpacity
                style={[aiOpsStyles((theme ?? _styleTheme)).button, themeStyle('components_admin_aiOps_AiOpsRecommendations_6', { theme: theme }, (theme ?? _styleTheme)), busy && aiOpsStyles((theme ?? _styleTheme)).disabled]}
                disabled={busy}
                onPress={() => onApply(recommendation)}
              >
                <Text style={aiOpsStyles((theme ?? _styleTheme)).buttonText}>{busy ? 'Saving...' : 'Apply'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[aiOpsStyles((theme ?? _styleTheme)).button, themeStyle('components_admin_aiOps_AiOpsRecommendations_7', { theme: theme }, (theme ?? _styleTheme)), busy && aiOpsStyles((theme ?? _styleTheme)).disabled]}
                disabled={busy}
                onPress={() => onDismiss(recommendation)}
              >
                <Text style={aiOpsStyles((theme ?? _styleTheme)).buttonText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      );
    })}
  </View>
)); };
