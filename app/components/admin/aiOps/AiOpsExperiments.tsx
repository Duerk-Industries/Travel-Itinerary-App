import React from 'react';
import { Text, View } from 'react-native';
import type { AppTheme } from '../../../theme/theme';
import { aiOpsStyles, cardStyle } from './shared';
import type { AiExperiment } from './types';

export const AiOpsExperiments: React.FC<{ theme: AppTheme; experiments: AiExperiment[] }> = ({ theme, experiments }) => (
  <View style={[aiOpsStyles.card, cardStyle(theme)]}>
    <Text style={[aiOpsStyles.cardTitle, { color: theme.colors.text }]}>Experiments</Text>
    {experiments.length === 0 ? <Text style={[aiOpsStyles.empty, { color: theme.colors.textMuted }]}>No experiments running.</Text> : null}
    {experiments.map((experiment) => (
      <View key={experiment.experimentId} style={aiOpsStyles.compactRow}>
        <Text style={[aiOpsStyles.cardTitle, { color: theme.colors.text }]}>{experiment.name}</Text>
        <Text style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>
          {experiment.featureKey} - {experiment.experimentKind} - {experiment.status} - {experiment.variants.length} variants
        </Text>
      </View>
    ))}
  </View>
);
