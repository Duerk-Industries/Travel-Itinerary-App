import React from 'react';
import { Text, View } from 'react-native';
import type { AppTheme } from '../../../theme/theme';
import { aiOpsStyles, cardStyle } from './shared';
import type { AiRecommendation } from './types';

export const AiOpsRecommendations: React.FC<{ theme: AppTheme; recommendations: AiRecommendation[] }> = ({ theme, recommendations }) => (
  <View style={[aiOpsStyles.card, cardStyle(theme)]}>
    <Text style={[aiOpsStyles.cardTitle, { color: theme.colors.text }]}>Recommendations</Text>
    {recommendations.length === 0 ? <Text style={[aiOpsStyles.empty, { color: theme.colors.textMuted }]}>No recommendations proposed.</Text> : null}
    {recommendations.map((recommendation) => (
      <View key={recommendation.recommendationId} style={aiOpsStyles.compactRow}>
        <Text style={[aiOpsStyles.cardTitle, { color: theme.colors.text }]}>{recommendation.recommendationType}</Text>
        <Text style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>
          {recommendation.featureKey} - {recommendation.status} - {recommendation.confidence}
        </Text>
        <Text style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>{recommendation.rationale}</Text>
      </View>
    ))}
  </View>
);
