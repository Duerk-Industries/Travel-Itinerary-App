import React, { useState } from 'react';
import { Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import { toWebStyle } from '../utils/webStyle';
import { formatMemberDisplayName } from '../utils/memberDisplay';
import type { AppTheme } from '../theme/theme';
import { DEFAULT_NEW_ITINERARY_STATUS, ITINERARY_STATUSES, normalizeItineraryStatus } from '../utils/itineraryStatus';
import type { CarRentalDraft } from '../tabs/carRentals';

// Single source of truth for the "add/edit car rental" form, styled to match
// FlightEditingForm/LodgingForm/ActivityEditForm (same modalCard shell, per-field
// labels, plain text inputs, toggle-chip pickers) instead of the panel's previous
// bespoke unlabeled grid layout. Shared by CarRentalsPanel (the Car Rentals tab)
// and the Overview day-detail "quick edit" so both present an identical dialog.

type NativeDateTimePickerType = typeof import('@react-native-community/datetimepicker').default;
let NativeDateTimePicker: NativeDateTimePickerType | null = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-community/datetimepicker');
    NativeDateTimePicker = (mod?.default ?? mod) as NativeDateTimePickerType;
  } catch {
    NativeDateTimePicker = null;
  }
}

export type CarRentalFormMember = {
  id: string;
  guestName?: string;
  email?: string;
  userEmail?: string;
  firstName?: string;
  lastName?: string;
  status?: 'active' | 'pending' | 'removed';
  removedAt?: string | null;
};

type CarRentalDateField = 'pickupDate' | 'dropoffDate';

export type CarRentalEditFormProps = {
  draft: CarRentalDraft;
  onChange: (updater: (prev: CarRentalDraft) => CarRentalDraft) => void;
  onSave: () => void | Promise<void>;
  onCancel: () => void;
  isNew: boolean;
  /** Group members eligible to be assigned a rental. Removed members are filtered locally. */
  members: CarRentalFormMember[];
  styles: Record<string, any>;
  theme?: AppTheme;
};

const CarRentalEditForm: React.FC<CarRentalEditFormProps> = ({
  draft,
  onChange,
  onSave,
  onCancel,
  isNew,
  members,
  styles,
  theme,
}) => {
  const [dateField, setDateField] = useState<CarRentalDateField | null>(null);
  const [pickerValue, setPickerValue] = useState<Date>(new Date());
  // Keep this list in sync with lodging and activity editors: guests and
  // pending travelers are valid trip participants, while removed members are
  // never offered for new assignments.
  const activeMembers = members.filter((member) => member.status !== 'removed' && !member.removedAt);

  const toggleBaseStyle = styles.toggleOption ?? {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme?.colors.border ?? '#111',
    backgroundColor: theme?.colors.surface ?? '#fff',
  };
  const toggleSelectedStyle = styles.toggleOptionSelected ?? {
    backgroundColor: theme ? (theme.mode === 'dark' ? '#1A3A50' : '#DDE8F0') : '#e5e7eb',
    borderColor: theme?.colors.link ?? '#111',
  };
  const toggleTextStyle = styles.toggleOptionText ?? { color: theme?.colors.text ?? '#111', fontWeight: '600' };
  const toggleTextSelectedStyle = styles.toggleOptionTextSelected ?? { color: theme?.colors.text ?? '#111' };

  const openDatePicker = (field: CarRentalDateField) => {
    setDateField(field);
    const current = draft[field];
    setPickerValue(current ? new Date(current) : new Date());
  };

  const status = normalizeItineraryStatus(draft.status, DEFAULT_NEW_ITINERARY_STATUS);

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalOverlay} testID="car-rental-form-modal">
        <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={onCancel} />
        <View style={[styles.modalCard, { marginTop: 0 }]}>
          <Text style={styles.sectionTitle}>{isNew ? 'Add Car Rental' : 'Edit Car Rental'}</Text>
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingRight: 12 }}>
            <Text style={styles.modalLabel}>Status</Text>
            {Platform.OS === 'web' ? (
              <select
                value={status}
                onChange={(e) => onChange((prev) => ({ ...prev, status: normalizeItineraryStatus(e.target.value, DEFAULT_NEW_ITINERARY_STATUS) }))}
                style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
              >
                {ITINERARY_STATUSES.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <View style={styles.payerChips}>
                {ITINERARY_STATUSES.map((opt) => {
                  const selected = status === opt;
                  return (
                    <TouchableOpacity
                      key={`car-status-${opt}`}
                      style={[toggleBaseStyle, selected && toggleSelectedStyle]}
                      onPress={() => onChange((prev) => ({ ...prev, status: opt }))}
                    >
                      <Text style={[toggleTextStyle, selected && toggleTextSelectedStyle]}>{opt}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            <Text style={styles.modalLabel}>Pick-up location</Text>
            <TextInput
              style={styles.input}
              placeholder="Pick-up location"
              value={draft.pickupLocation}
              onChangeText={(text: string) => onChange((prev) => ({ ...prev, pickupLocation: text }))}
            />
            <Text style={styles.modalLabel}>Pick-up date</Text>
            {Platform.OS === 'web' ? (
              <input
                style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
                type="date"
                title="Pick-up date"
                value={draft.pickupDate}
                onChange={(e) => onChange((prev) => ({ ...prev, pickupDate: e.target.value }))}
              />
            ) : (
              <TouchableOpacity style={styles.input} onPress={() => openDatePicker('pickupDate')}>
                <Text style={styles.cellText}>{draft.pickupDate || 'YYYY-MM-DD'}</Text>
              </TouchableOpacity>
            )}
            <Text style={styles.modalLabel}>Drop-off location</Text>
            <TextInput
              style={styles.input}
              placeholder="Drop-off location"
              value={draft.dropoffLocation}
              onChangeText={(text: string) => onChange((prev) => ({ ...prev, dropoffLocation: text }))}
            />
            <Text style={styles.modalLabel}>Drop-off date</Text>
            {Platform.OS === 'web' ? (
              <input
                style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
                type="date"
                title="Drop-off date"
                value={draft.dropoffDate}
                onChange={(e) => onChange((prev) => ({ ...prev, dropoffDate: e.target.value }))}
              />
            ) : (
              <TouchableOpacity style={styles.input} onPress={() => openDatePicker('dropoffDate')}>
                <Text style={styles.cellText}>{draft.dropoffDate || 'YYYY-MM-DD'}</Text>
              </TouchableOpacity>
            )}
            <Text style={styles.modalLabel}>Vendor</Text>
            <TextInput
              style={styles.input}
              placeholder="Vendor"
              value={draft.vendor}
              onChangeText={(text: string) => onChange((prev) => ({ ...prev, vendor: text }))}
            />
            <Text style={styles.modalLabel}>Reference</Text>
            <TextInput
              style={styles.input}
              placeholder="Reference"
              value={draft.reference}
              onChangeText={(text: string) => onChange((prev) => ({ ...prev, reference: text }))}
            />
            <Text style={styles.modalLabel}>Prepaid</Text>
            <View style={styles.payerChips}>
              {(['Yes', 'No'] as const).map((opt) => {
                const selected = draft.prepaid === opt;
                return (
                  <TouchableOpacity
                    key={`car-prepaid-${opt}`}
                    style={[toggleBaseStyle, selected && toggleSelectedStyle]}
                    onPress={() => onChange((prev) => ({ ...prev, prepaid: opt }))}
                  >
                    <Text style={[toggleTextStyle, selected && toggleTextSelectedStyle]}>{opt}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.modalLabel}>Cost</Text>
            <TextInput
              style={styles.input}
              placeholder="Cost"
              keyboardType="numeric"
              value={draft.cost}
              onChangeText={(text: string) => onChange((prev) => ({ ...prev, cost: sanitizeCostInput(text) }))}
            />
            <Text style={styles.modalLabel}>Car model</Text>
            <TextInput
              style={styles.input}
              placeholder="Car model"
              value={draft.model}
              onChangeText={(text: string) => onChange((prev) => ({ ...prev, model: text }))}
            />
            <Text style={styles.modalLabel}>Notes</Text>
            <TextInput
              style={[styles.input, { minHeight: 96, textAlignVertical: 'top' }]}
              placeholder="Notes"
              value={draft.notes}
              onChangeText={(text: string) => onChange((prev) => ({ ...prev, notes: text }))}
              multiline
            />
            <Text style={styles.modalLabel}>For</Text>
            <View style={styles.payerChips}>
              {activeMembers.map((m) => {
                const selected = draft.travelerIds.includes(m.id);
                const name = formatMemberDisplayName(m);
                return (
                  <TouchableOpacity
                    key={`car-traveler-${m.id}`}
                    style={[toggleBaseStyle, selected && toggleSelectedStyle]}
                    onPress={() =>
                      onChange((prev) => {
                        const next = selected ? prev.travelerIds.filter((id) => id !== m.id) : [...prev.travelerIds, m.id];
                        return { ...prev, travelerIds: next };
                      })
                    }
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
                const name = formatMemberDisplayName(m);
                return (
                  <TouchableOpacity
                    key={`car-payer-${m.id}`}
                    style={[toggleBaseStyle, selected && toggleSelectedStyle]}
                    onPress={() =>
                      onChange((prev) => {
                        const next = selected ? prev.paidBy.filter((id) => id !== m.id) : [...prev.paidBy, m.id];
                        return { ...prev, paidBy: next };
                      })
                    }
                  >
                    <Text style={[toggleTextStyle, selected && toggleTextSelectedStyle]}>{name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          <View style={[styles.tableFooter, { justifyContent: 'space-between' }]}>
            <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={onCancel} testID="car-rental-cancel">
              <Text style={styles.dangerButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={onSave} testID="car-rental-save">
              <Text style={styles.buttonText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      {Platform.OS !== 'web' && dateField && NativeDateTimePicker ? (
        <NativeDateTimePicker
          value={pickerValue}
          mode="date"
          onChange={(_, date) => {
            if (!date) {
              setDateField(null);
              return;
            }
            const iso = date.toISOString().slice(0, 10);
            onChange((prev) => ({ ...prev, [dateField]: iso }));
            setDateField(null);
          }}
        />
      ) : null}
    </Modal>
  );
};

export default CarRentalEditForm;
