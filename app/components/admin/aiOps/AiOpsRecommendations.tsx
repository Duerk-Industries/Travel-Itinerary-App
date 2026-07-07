import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { AppTheme } from '../../../theme/theme';
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
}> = ({ theme, recommendations, reason, saving, setReason, onApply, onDismiss }) => (
  <View style={[aiOpsStyles.card, cardStyle(theme)]}>
    <Text style={[aiOpsStyles.cardTitle, { color: theme.colors.text }]}>Recommendations</Text>
    <TextInput
      style={[aiOpsStyles.input, inputStyle(theme)]}
      value={reason}
      onChangeText={setReason}
      placeholder="Reason for audit log"
      placeholderTextColor={theme.colors.textMuted}
    />
    {recommendations.length === 0 ? <Text style={[aiOpsStyles.empty, { color: theme.colors.textMuted }]}>No recommendations proposed.</Text> : null}
    {recommendations.map((recommendation) => {
      const busy = saving === `recommendation-${recommendation.recommendationId}`;
      return (
        <View key={recommendation.recommendationId} style={aiOpsStyles.compactRow}>
          <Text style={[aiOpsStyles.cardTitle, { color: theme.colors.text }]}>{recommendation.recommendationType}</Text>
          <Text style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>
            {recommendation.featureKey} - {recommendation.status} - {recommendation.confidence}
          </Text>
          <Text style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>{recommendation.rationale}</Text>
          {recommendation.status === 'proposed' ? (
            <View style={aiOpsStyles.rowWrap}>
              <TouchableOpacity
                style={[aiOpsStyles.button, { backgroundColor: theme.colors.success }, busy && aiOpsStyles.disabled]}
                disabled={busy}
                onPress={() => onApply(recommendation)}
              >
                <Text style={aiOpsStyles.buttonText}>{busy ? 'Saving...' : 'Apply'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[aiOpsStyles.button, { backgroundColor: theme.colors.alert }, busy && aiOpsStyles.disabled]}
                disabled={busy}
                onPress={() => onDismiss(recommendation)}
              >
                <Text style={aiOpsStyles.buttonText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      );
    })}
  </View>
);
