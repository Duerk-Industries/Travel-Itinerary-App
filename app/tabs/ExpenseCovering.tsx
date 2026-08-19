import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import SelectField, { type SelectFieldOption } from '../components/SelectField';
import type { AppTheme } from '../theme/theme';

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
  reportableMembers,
  coveredBy,
  setCoveredBy,
  formatMemberName,
  saveCoveredBy,
  styles,
  theme,
}) => {
  const textColor = theme?.colors.text ?? styles.cellText?.color;
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Expense Covering</Text>
      <Text style={styles.helperText}>
        Assign a traveler's expenses to be covered by another traveler. The covered traveler will not appear in cost reports.
      </Text>
      {groupMembers.filter(m => !Object.values(coveredBy).includes(m.id)).map(member => {
        const options: SelectFieldOption[] = [
          { label: 'No one', value: '' },
          ...reportableMembers
            .filter((m) => m.id !== member.id)
            .map((coveringMember) => ({ label: formatMemberName(coveringMember), value: coveringMember.id })),
        ];
        return (
        <View
          key={`cover-for-${member.id}`}
          style={[styles.row, { alignItems: 'flex-start' }]}
          testID={`covering-row-${member.id}`}
        >
          <Text style={[styles.cellText, textColor ? { color: textColor } : null, { flex: 1, minWidth: 0, paddingTop: 10 }]}>
            {formatMemberName(member)} is covered by:
          </Text>
          <SelectField
            styles={styles}
            value={coveredBy[member.id] ?? ''}
            options={options}
            placeholder="No one"
            title={`${formatMemberName(member)} covered by`}
            style={{ flex: 1, minWidth: 150 }}
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
        <TouchableOpacity style={[styles.button, {marginTop: 12}]} onPress={saveCoveredBy}>
          <Text style={styles.buttonText}>Save Covering Rules</Text>
      </TouchableOpacity>
    </View>
  );
};

export default ExpenseCovering;
