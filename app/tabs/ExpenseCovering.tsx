import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import SelectField, { type SelectFieldOption } from '../components/SelectField';


type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

interface GroupMemberOption {
  id: string;
  guestName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  status?: 'active' | 'pending' | 'removed';
}

interface ExpenseCoveringProps {
  groupMembers: GroupMemberOption[];
  reportableMembers: GroupMemberOption[];
  coveredBy: Record<string, string>;
  setCoveredBy: Setter<Record<string, string>>;
  formatMemberName: (member: GroupMemberOption) => string;
  payerName: (id: string) => string;
  saveCoveredBy: () => Promise<void>;
  styles: Record<string, any>;
  theme?: AppTheme;
}

const ExpenseCovering: React.FC<ExpenseCoveringProps> = ({
  groupMembers,
  coveredBy,
  setCoveredBy,
  formatMemberName,
  saveCoveredBy,
  styles,
  theme: _providedTheme,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const textColor = theme?.colors.text ?? styles.cellText?.color;
  const activeMembers = groupMembers.filter((member) => member.status !== 'removed');

  const wouldCreateCycle = (coveredId: string, candidateId: string): boolean => {
    const seen = new Set<string>();
    let current: string | undefined = candidateId;
    while (current && !seen.has(current)) {
      if (current === coveredId) return true;
      seen.add(current);
      current = coveredBy[current];
    }
    return false;
  };

  return (
    <View style={styles.card} testID="expense-covering">
      <Text style={styles.sectionTitle}>Expense Covering</Text>
      <Text style={styles.helperText}>
        Assign a traveler's expenses to be covered by another traveler. The covered traveler will not appear in cost reports.
      </Text>
      {activeMembers.map(member => {
        const options: SelectFieldOption[] = [
          { label: 'No one', value: '' },
          ...activeMembers
            .filter((m) => m.id !== member.id && !wouldCreateCycle(member.id, m.id))
            .map((coveringMember) => ({ label: formatMemberName(coveringMember), value: coveringMember.id }))
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true })),
        ];
        return (
        <View
          key={`cover-for-${member.id}`}
          style={[styles.row, themeStyle('tabs_ExpenseCovering_1', {  }, (theme ?? _styleTheme))]}
          testID={`covering-row-${member.id}`}
        >
          <Text style={[styles.cellText, textColor ? themeStyle('tabs_ExpenseCovering_2', { textColor: textColor }, (theme ?? _styleTheme)) : null, themeStyle('tabs_ExpenseCovering_3', {  }, (theme ?? _styleTheme))]}>
            {formatMemberName(member)} is covered by:
          </Text>
          <SelectField
            testID={`covering-select-${member.id}`}
            styles={styles}
            value={coveredBy[member.id] ?? ''}
            options={options}
            placeholder="No one"
            title={`${formatMemberName(member)} covered by`}
            style={themeStyle('tabs_ExpenseCovering_4', {  }, (theme ?? _styleTheme))}
            onChange={(value) => {
              if (!value) {
                setCoveredBy((previous) => {
                  const next = { ...previous };
                  delete next[member.id];
                  return next;
                });
                return;
              }
              setCoveredBy((previous) => ({ ...previous, [member.id]: value }));
            }}
          />
        </View>
      )})}
        <TouchableOpacity style={[styles.button, themeStyle('tabs_ExpenseCovering_5', {  }, (theme ?? _styleTheme))]} onPress={saveCoveredBy} testID="covering-save">
          <Text style={styles.buttonText}>Save Covering Rules</Text>
      </TouchableOpacity>
    </View>
  );
};

export default ExpenseCovering;
