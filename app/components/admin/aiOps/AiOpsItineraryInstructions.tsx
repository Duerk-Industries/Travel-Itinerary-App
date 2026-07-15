import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { AppTheme } from '../../../theme/theme';
import { aiOpsStyles, cardStyle, inputStyle } from './shared';
import type { ItineraryInstructionDocument } from './types';

const PHASE_LABELS: Record<string, string> = {
  p0: 'P0 Normalize',
  p1: 'P1 Route',
  p2: 'P2 Days',
  p3: 'P3 Validate',
  p4: 'P4 Render',
};

export const AiOpsItineraryInstructions: React.FC<{
  theme: AppTheme;
  phases: ItineraryInstructionDocument[];
  drafts: Record<string, string>;
  selected: Record<string, boolean>;
  reason: string;
  saving: string | null;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setSelected: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setReason: (value: string) => void;
  onSave: () => void;
}> = ({ theme, phases, drafts, selected, reason, saving, setDrafts, setSelected, setReason, onSave }) => (
  <View>
    <Text style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>
      Markdown documents must include ## System and ## User sections. Saving changes affects future itinerary generations only.
    </Text>
    {phases.map((phase) => {
      const checked = selected[phase.phase] ?? false;
      return (
        <View key={phase.phase} style={[aiOpsStyles.card, cardStyle(theme)]}>
          <View style={aiOpsStyles.rowWrap}>
            <TouchableOpacity
              style={[
                aiOpsStyles.button,
                { backgroundColor: checked ? theme.colors.primary : theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
              ]}
              onPress={() => setSelected((prev) => ({ ...prev, [phase.phase]: !checked }))}
            >
              <Text style={[aiOpsStyles.buttonText, { color: checked ? '#fff' : theme.colors.text }]}>
                {checked ? 'Selected' : 'Select'}
              </Text>
            </TouchableOpacity>
            <View>
              <Text style={[aiOpsStyles.cardTitle, { color: theme.colors.text }]}>{PHASE_LABELS[phase.phase] ?? phase.phase}</Text>
              <Text style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>
                {phase.source}{phase.updatedAt ? `, updated ${phase.updatedAt}` : ''}
              </Text>
            </View>
          </View>
          <TextInput
            style={[aiOpsStyles.input, aiOpsStyles.textarea, inputStyle(theme)]}
            value={drafts[phase.phase] ?? phase.markdown}
            onChangeText={(value) => {
              setDrafts((prev) => ({ ...prev, [phase.phase]: value }));
              setSelected((prev) => ({ ...prev, [phase.phase]: true }));
            }}
            multiline
            placeholder={'## System\n\n...\n\n## User\n\n...'}
            placeholderTextColor={theme.colors.textMuted}
          />
        </View>
      );
    })}
    <TextInput
      style={[aiOpsStyles.input, inputStyle(theme)]}
      value={reason}
      onChangeText={setReason}
      placeholder="Reason for instruction update"
      placeholderTextColor={theme.colors.textMuted}
    />
    <TouchableOpacity
      style={[aiOpsStyles.button, { backgroundColor: theme.colors.primary }, saving === 'itinerary-instructions' && aiOpsStyles.disabled]}
      onPress={onSave}
      disabled={saving === 'itinerary-instructions'}
    >
      <Text style={aiOpsStyles.buttonText}>Save selected instructions</Text>
    </TouchableOpacity>
  </View>
);
