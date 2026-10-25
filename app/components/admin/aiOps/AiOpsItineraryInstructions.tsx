import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../../../theme/theme';

import { useAppTheme as useStyleTheme } from '../../../theme/ThemeContext';
import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

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
}> = ({ theme: _providedTheme, phases, drafts, selected, reason, saving, setDrafts, setSelected, setReason, onSave }) => { const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme); return ((
  <View>
    <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardSub, themeStyle('components_admin_aiOps_AiOpsItineraryInstructions_1', { theme: theme }, (theme ?? _styleTheme))]}>
      Markdown documents must include ## System and ## User sections. Saving changes affects future itinerary generations only.
    </Text>
    {phases.map((phase) => {
      const checked = selected[phase.phase] ?? false;
      return (
        <View key={phase.phase} style={[aiOpsStyles((theme ?? _styleTheme)).card, cardStyle(theme)]}>
          <View style={aiOpsStyles((theme ?? _styleTheme)).rowWrap}>
            <TouchableOpacity
              style={[
                aiOpsStyles((theme ?? _styleTheme)).button,
                themeStyle('components_admin_aiOps_AiOpsItineraryInstructions_2', { checked: checked, theme: theme }, (theme ?? _styleTheme)),
              ]}
              onPress={() => setSelected((prev) => ({ ...prev, [phase.phase]: !checked }))}
            >
              <Text style={[aiOpsStyles((theme ?? _styleTheme)).buttonText, themeStyle('components_admin_aiOps_AiOpsItineraryInstructions_3', { checked: checked, theme: theme }, (theme ?? _styleTheme))]}>
                {checked ? 'Selected' : 'Select'}
              </Text>
            </TouchableOpacity>
            <View>
              <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardTitle, themeStyle('components_admin_aiOps_AiOpsItineraryInstructions_4', { theme: theme }, (theme ?? _styleTheme))]}>{PHASE_LABELS[phase.phase] ?? phase.phase}</Text>
              <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardSub, themeStyle('components_admin_aiOps_AiOpsItineraryInstructions_5', { theme: theme }, (theme ?? _styleTheme))]}>
                {phase.source}{phase.updatedAt ? `, updated ${phase.updatedAt}` : ''}
              </Text>
            </View>
          </View>
          <TextInput
            style={[aiOpsStyles((theme ?? _styleTheme)).input, aiOpsStyles((theme ?? _styleTheme)).textarea, inputStyle(theme)]}
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
      style={[aiOpsStyles((theme ?? _styleTheme)).input, inputStyle(theme)]}
      value={reason}
      onChangeText={setReason}
      placeholder="Reason for instruction update"
      placeholderTextColor={theme.colors.textMuted}
    />
    <TouchableOpacity
      style={[aiOpsStyles((theme ?? _styleTheme)).button, themeStyle('components_admin_aiOps_AiOpsItineraryInstructions_6', { theme: theme }, (theme ?? _styleTheme)), saving === 'itinerary-instructions' && aiOpsStyles((theme ?? _styleTheme)).disabled]}
      onPress={onSave}
      disabled={saving === 'itinerary-instructions'}
    >
      <Text style={aiOpsStyles((theme ?? _styleTheme)).buttonText}>Save selected instructions</Text>
    </TouchableOpacity>
  </View>
)); };
