import React, { useMemo } from 'react';
import { Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { LodgingDraft } from '../tabs/lodging';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import { toWebStyle } from '../utils/webStyle';
import { DEFAULT_NEW_ITINERARY_STATUS, ITINERARY_STATUSES, normalizeItineraryStatus } from '../utils/itineraryStatus';

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

  const resolveTravelerLabel = (member: MemberOption) => {
    const first = member.firstName?.trim() ?? '';
    const last = member.lastName?.trim() ?? '';
    if (first || last) return `${first} ${last}`.trim();
    const guest = member.guestName?.trim() ?? '';
    if (guest) return guest;
    const email = (member.email ?? '').trim();
    if (email) return email;
    return 'Traveler';
  };

  const toggleBaseStyle = styles.toggleOption ?? {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#111',
    backgroundColor: '#fff',
  };
  const toggleSelectedStyle = styles.toggleOptionSelected ?? {
    backgroundColor: '#e5e7eb',
    borderColor: '#111',
  };
  const toggleTextStyle = styles.toggleOptionText ?? { color: '#111', fontWeight: '600' };
  const toggleTextSelectedStyle = styles.toggleOptionTextSelected ?? { color: '#111' };

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
          style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
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
        <View style={[styles.modalField, isCompact && { minWidth: '100%' }]}>
          <Text style={styles.modalLabel}>Status</Text>
          {Platform.OS === 'web' ? (
            <select
              value={normalizeItineraryStatus(draft.status, DEFAULT_NEW_ITINERARY_STATUS)}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, status: normalizeItineraryStatus(e.target.value, DEFAULT_NEW_ITINERARY_STATUS) }))
              }
              style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
            >
              {ITINERARY_STATUSES.map((opt) => (
                <option key={`lodging-status-${opt}`} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <View style={styles.payerChips}>
              {ITINERARY_STATUSES.map((opt) => {
                const selected = normalizeItineraryStatus(draft.status, DEFAULT_NEW_ITINERARY_STATUS) === opt;
                return (
                  <TouchableOpacity
                    key={`lodging-status-${opt}`}
                    style={[toggleBaseStyle, selected && toggleSelectedStyle]}
                    onPress={() => setDraft((prev) => ({ ...prev, status: opt }))}
                  >
                    <Text style={[toggleTextStyle, selected && toggleTextSelectedStyle]}>{opt}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      </View>

      <View style={[styles.modalRow, isCompact && { flexDirection: 'column' }]}>
        <View style={[styles.modalField, isCompact && { minWidth: '100%' }]}>
          <Text style={styles.modalLabel}>Name</Text>
          <TextInput
            style={styles.input}
            placeholder="Hotel name"
            value={draft.name}
            onChangeText={(text: string) => setDraft((prev) => ({ ...prev, name: text }))}
          />
        </View>
        <View style={[styles.modalField, isCompact && { minWidth: '100%' }]}>
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
        <View style={[styles.modalField, isCompact && { minWidth: '100%' }]}>
          <Text style={styles.modalLabel}>Check-in date</Text>
          {renderDateInput('checkIn', draft.checkInDate, (value) =>
            setDraft((prev) => ({ ...prev, checkInDate: value }))
          )}
        </View>
        <View style={[styles.modalField, isCompact && { minWidth: '100%' }]}>
          <Text style={styles.modalLabel}>Check-out date</Text>
          {renderDateInput('checkOut', draft.checkOutDate, (value) =>
            setDraft((prev) => ({ ...prev, checkOutDate: value }))
          )}
        </View>
      </View>

      <View style={[styles.modalRow, isCompact && { flexDirection: 'column' }]}>
        <View style={[styles.modalField, isCompact && { minWidth: '100%' }]}>
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
        <View style={[styles.modalField, isCompact && { minWidth: '100%' }]}>
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
      <View style={styles.payerChips}>
        {activeMembers.map((m) => {
          const selected = draft.travelerIds.includes(m.id);
          const name = resolveTravelerLabel(m);
          return (
            <TouchableOpacity
              key={`traveler-toggle-${m.id}`}
              style={[toggleBaseStyle, selected && toggleSelectedStyle]}
              onPress={() => {
                const next = selected
                  ? draft.travelerIds.filter((id) => id !== m.id)
                  : [...draft.travelerIds, m.id];
                updateTravelerIds(next);
              }}
            >
              <Text style={[toggleTextStyle, selected && toggleTextSelectedStyle]}>{name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.modalLabel}>Paid by</Text>
      <View style={styles.payerChips}>
        {activeMembers.map((m) => {
          const selected = draft.paidBy.includes(m.id);
          const name = resolveTravelerLabel(m);
          return (
            <TouchableOpacity
              key={`payer-toggle-${m.id}`}
              style={[toggleBaseStyle, selected && toggleSelectedStyle]}
              onPress={() => {
                const nextPaidBy = selected
                  ? draft.paidBy.filter((id) => id !== m.id)
                  : [...draft.paidBy, m.id];
                setDraft((prev) => ({ ...prev, paidBy: ensurePaidBy(nextPaidBy) }));
              }}
            >
              <Text style={[toggleTextStyle, selected && toggleTextSelectedStyle]}>{name}</Text>
            </TouchableOpacity>
          );
        })}
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
