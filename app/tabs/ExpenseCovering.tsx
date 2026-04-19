import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import DropdownOptionButton from '../components/DropdownOptionButton';

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
}

const ExpenseCovering: React.FC<ExpenseCoveringProps> = ({
  groupMembers,
  reportableMembers,
  coveredBy,
  setCoveredBy,
  formatMemberName,
  payerName,
  saveCoveredBy,
  styles,
}) => {
  const [showCoveredByDropdown, setShowCoveredByDropdown] = useState<string | null>(null);

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Expense Covering</Text>
      <Text style={styles.helperText}>
        Assign a traveler's expenses to be covered by another traveler. The covered traveler will not appear in cost reports.
      </Text>
      {groupMembers.filter(m => !Object.values(coveredBy).includes(m.id)).map(member => (
        <View key={`cover-for-${member.id}`} style={[styles.row, { zIndex: showCoveredByDropdown === member.id ? 100 : 1 }]} testID={`covering-row-${member.id}`}>
          <Text style={{width: 150}}>{formatMemberName(member)} is covered by:</Text>
          <View style={[styles.dropdown, {flex: 1}]}>
              <TouchableOpacity style={styles.input} onPress={() => setShowCoveredByDropdown(showCoveredByDropdown === member.id ? null : member.id)}>
                  <Text style={styles.cellText}>
                      {coveredBy[member.id] ? payerName(coveredBy[member.id]) : 'No one'}
                  </Text>
              </TouchableOpacity>
              {showCoveredByDropdown === member.id && (
                  <View style={styles.dropdownList}>
                      <DropdownOptionButton styles={styles} onPress={() => { setCoveredBy(p => { const n = {...p}; delete n[member.id]; return n; }); setShowCoveredByDropdown(null); }}>
                          <Text style={styles.cellText}>No one</Text>
                      </DropdownOptionButton>
                      {reportableMembers.filter(m => m.id !== member.id).map(coveringMember => (
                          <DropdownOptionButton key={coveringMember.id} styles={styles} onPress={() => { setCoveredBy(p => ({...p, [member.id]: coveringMember.id})); setShowCoveredByDropdown(null); }}>
                              <Text style={styles.cellText}>{formatMemberName(coveringMember)}</Text>
                          </DropdownOptionButton>
                      ))}
                  </View>
              )}
          </View>
        </View>
      ))}
        <TouchableOpacity style={[styles.button, {marginTop: 12}]} onPress={saveCoveredBy}>
          <Text style={styles.buttonText}>Save Covering Rules</Text>
      </TouchableOpacity>
    </View>
  );
};

export default ExpenseCovering;
