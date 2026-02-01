import React, { useMemo } from 'react';
import { Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { LodgingDraft } from '../tabs/lodging';
import { sanitizeCostInput } from '../utils/sanitizeCost';

type MemberOption = {
  id: string;
  guestName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  status?: 'active' | 'pending' | 'removed';
  removedAt?: string | null;
};

type LodgingFormProps = {
  draft: LodgingDraft;
  setDraft: React.Dispatch<React.SetStateAction<LodgingDraft>>;
  groupMembers: MemberOption[];
  formatMemberName: (member: MemberOption) => string;
  payerName: (id: string) => string;
  defaultPayerId?: string | null;
  styles: Record<string, any>;
  onOpenDatePicker?: (field: 'checkIn' | 'checkOut' | 'refundBy') => void;
  isCompact: boolean;
};

const LodgingForm: React.FC<LodgingFormProps> = ({
  draft,
  setDraft,
  groupMembers,
  formatMemberName,
  payerName,
  defaultPayerId,
  styles,
  onOpenDatePicker,
  isCompact,
}) => {
  const activeMembers = useMemo(
    () => groupMembers.filter((m) => m.status !== 'removed' && !m.removedAt),
    [groupMembers]
  );

  const ensurePaidBy = (nextPaidBy: string[]) => {
    if (nextPaidBy.length) return nextPaidBy;
    if (defaultPayerId) return [defaultPayerId];
    if (draft.travelerIds.length) return [draft.travelerIds[0]];
    return [];
  };

  const updateTravelerIds = (nextIds: string[]) => {
    const filtered = nextIds.filter(Boolean);
    const nextPaidBy = draft.paidBy.filter((id) => filtered.includes(id));
    setDraft((prev) => ({
      ...prev,
      travelerIds: filtered,
      paidBy: ensurePaidBy(nextPaidBy),
    }));
  };

  const renderDateInput = (
    field: 'checkIn' | 'checkOut' | 'refundBy',
    value: string,
    onChange: (next: string) => void
  ) => {
    if (Platform.OS === 'web') {
      return (
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={styles.input as any}
        />
      );
    }
    return (
      <TouchableOpacity
        style={styles.input}
        onPress={() => (onOpenDatePicker ? onOpenDatePicker(field) : undefined)}
      >
        <Text style={styles.cellText}>{value || 'YYYY-MM-DD'}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <>
      <View style={[styles.modalRow, isCompact && { flexDirection: 'column' }]}>
        <View style={styles.modalField}>
          <Text style={styles.modalLabel}>Name</Text>
          <TextInput
            style={styles.input}
            placeholder="Hotel name"
            value={draft.name}
            onChangeText={(text: string) => setDraft((prev) => ({ ...prev, name: text }))}
          />
        </View>
        <View style={styles.modalField}>
          <Text style={styles.modalLabel}>Rooms</Text>
          <TextInput
            style={styles.input}
            placeholder="1"
            keyboardType="numeric"
            value={draft.rooms}
            onChangeText={(text: string) => setDraft((prev) => ({ ...prev, rooms: text }))}
          />
        </View>
      </View>

      <View style={[styles.modalRow, isCompact && { flexDirection: 'column' }]}>
        <View style={styles.modalField}>
          <Text style={styles.modalLabel}>Check-in date</Text>
          {renderDateInput('checkIn', draft.checkInDate, (value) =>
            setDraft((prev) => ({ ...prev, checkInDate: value }))
          )}
        </View>
        <View style={styles.modalField}>
          <Text style={styles.modalLabel}>Check-out date</Text>
          {renderDateInput('checkOut', draft.checkOutDate, (value) =>
            setDraft((prev) => ({ ...prev, checkOutDate: value }))
          )}
        </View>
      </View>

      <View style={[styles.modalRow, isCompact && { flexDirection: 'column' }]}>
        <View style={styles.modalField}>
          <View style={styles.modalRow}>
            <Text style={styles.modalLabel}>Refund by</Text>
            <TouchableOpacity onPress={() => setDraft((prev) => ({ ...prev, refundBy: '' }))}>
              <Text style={styles.linkText}>Clear</Text>
            </TouchableOpacity>
          </View>
          {renderDateInput('refundBy', draft.refundBy, (value) =>
            setDraft((prev) => ({ ...prev, refundBy: value }))
          )}
        </View>
        <View style={styles.modalField}>
          <Text style={styles.modalLabel}>Total cost</Text>
          <TextInput
            style={styles.input}
            placeholder="0.00"
            keyboardType="numeric"
            value={draft.totalCost}
            onChangeText={(text: string) =>
              setDraft((prev) => ({ ...prev, totalCost: sanitizeCostInput(text) }))
            }
          />
          <Text style={styles.helperText}>
            Per night: {draft.costPerNight ? `$${draft.costPerNight}` : '-'}
          </Text>
        </View>
      </View>

      <Text style={styles.modalLabel}>Travelers</Text>
      <View style={[styles.input, styles.payerBox]}>
        <View style={styles.payerChips}>
          {draft.travelerIds.map((id) => (
            <View key={`traveler-${id}`} style={styles.payerChip}>
              <Text style={styles.cellText}>{payerName(id)}</Text>
              <TouchableOpacity onPress={() => updateTravelerIds(draft.travelerIds.filter((x) => x !== id))}>
                <Text style={styles.removeText}>x</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
        <View style={styles.payerOptions}>
          {activeMembers
            .filter((m) => !draft.travelerIds.includes(m.id))
            .map((m) => (
              <TouchableOpacity
                key={`traveler-add-${m.id}`}
                style={styles.smallButton}
                onPress={() => updateTravelerIds([...draft.travelerIds, m.id])}
              >
                <Text style={styles.buttonText}>Add {formatMemberName(m)}</Text>
              </TouchableOpacity>
            ))}
        </View>
      </View>

      <Text style={styles.modalLabel}>Paid by</Text>
      <View style={[styles.input, styles.payerBox]}>
        <View style={styles.payerChips}>
          {draft.paidBy.map((id) => (
            <View key={`payer-${id}`} style={styles.payerChip}>
              <Text style={styles.cellText}>{payerName(id)}</Text>
              <TouchableOpacity
                onPress={() => {
                  const nextPaidBy = draft.paidBy.filter((x) => x !== id);
                  setDraft((prev) => ({ ...prev, paidBy: ensurePaidBy(nextPaidBy) }));
                }}
              >
                <Text style={styles.removeText}>x</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
        <View style={styles.payerOptions}>
          {activeMembers
            .filter((m) => !draft.paidBy.includes(m.id))
            .map((m) => (
              <TouchableOpacity
                key={`payer-add-${m.id}`}
                style={styles.smallButton}
                onPress={() => setDraft((prev) => ({ ...prev, paidBy: ensurePaidBy([...prev.paidBy, m.id]) }))}
              >
                <Text style={styles.buttonText}>Add {formatMemberName(m)}</Text>
              </TouchableOpacity>
            ))}
        </View>
      </View>

      <Text style={styles.modalLabel}>Address</Text>
      <TextInput
        style={styles.input}
        placeholder="Address"
        value={draft.address}
        onChangeText={(text: string) => setDraft((prev) => ({ ...prev, address: text }))}
      />
    </>
  );
};

export default LodgingForm;
