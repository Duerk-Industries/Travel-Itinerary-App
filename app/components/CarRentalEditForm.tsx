import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import PayerSelect from './PayerSelect';
import React from 'react';
import { Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Modal from './KeyboardAwareModal';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import { toWebStyle } from '../utils/webStyle';
import { formatMemberDisplayName } from '../utils/memberDisplay';

import { DEFAULT_NEW_ITINERARY_STATUS, ITINERARY_STATUSES, normalizeItineraryStatus } from '../utils/itineraryStatus';
import type { CarRentalDraft } from '../tabs/carRentals';
import DateField from './DateField';

// Single source of truth for the "add/edit car rental" form, styled to match
// FlightEditingForm/LodgingForm/ActivityEditForm (same modalCard shell, per-field
// labels, plain text inputs, toggle-chip pickers) instead of the panel's previous
// bespoke unlabeled grid layout. Shared by CarRentalsPanel (the Car Rentals tab)
// and the Overview day-detail "quick edit" so both present an identical dialog.

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
  theme: _providedTheme,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  // Keep this list in sync with lodging and activity editors: guests and
  // pending travelers are valid trip participants, while removed members are
  // never offered for new assignments.
  const activeMembers = members.filter((member) => member.status !== 'removed' && !member.removedAt);

  const toggleBaseStyle = styles.toggleOption ?? themeStyle('components_CarRentalEditForm_1', { theme: theme }, (theme ?? _styleTheme));
  const toggleSelectedStyle = styles.toggleOptionSelected ?? themeStyle('components_CarRentalEditForm_2', { theme: theme }, (theme ?? _styleTheme));
  const toggleTextStyle = styles.toggleOptionText ?? themeStyle('components_CarRentalEditForm_3', { theme: theme }, (theme ?? _styleTheme));
  const toggleTextSelectedStyle = styles.toggleOptionTextSelected ?? themeStyle('components_CarRentalEditForm_4', { theme: theme }, (theme ?? _styleTheme));

  const status = normalizeItineraryStatus(draft.status, DEFAULT_NEW_ITINERARY_STATUS);

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalOverlay} testID="car-rental-form-modal">
        <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={onCancel} />
        <View style={[styles.modalCard, themeStyle('components_CarRentalEditForm_5', {  }, (theme ?? _styleTheme))]}>
          <Text style={styles.sectionTitle}>{isNew ? 'Add Car Rental' : 'Edit Car Rental'}</Text>
          <ScrollView style={themeStyle('components_CarRentalEditForm_6', {  }, (theme ?? _styleTheme))} contentContainerStyle={themeStyle('components_CarRentalEditForm_7', {  }, (theme ?? _styleTheme))} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            <Text style={styles.modalLabel}>Status</Text>
            {Platform.OS === 'web' ? (
              <select
                value={status}
                onChange={(e) => onChange((prev) => ({ ...prev, status: normalizeItineraryStatus(e.target.value, DEFAULT_NEW_ITINERARY_STATUS) }))}
                style={toWebStyle(styles.input, themeStyle('components_CarRentalEditForm_8', {  }, (theme ?? _styleTheme)))}
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
            <DateField
              value={draft.pickupDate}
              onChange={(pickupDate) => onChange((prev) => ({ ...prev, pickupDate }))}
              styles={styles}
              theme={theme}
              testID="car-rental-pickup-date"
              accessibilityLabel="Pick-up date"
            />
            <Text style={styles.modalLabel}>Drop-off location</Text>
            <TextInput
              style={styles.input}
              placeholder="Drop-off location"
              value={draft.dropoffLocation}
              onChangeText={(text: string) => onChange((prev) => ({ ...prev, dropoffLocation: text }))}
            />
            <Text style={styles.modalLabel}>Drop-off date</Text>
            <DateField
              value={draft.dropoffDate}
              onChange={(dropoffDate) => onChange((prev) => ({ ...prev, dropoffDate }))}
              styles={styles}
              theme={theme}
              testID="car-rental-dropoff-date"
              accessibilityLabel="Drop-off date"
            />
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
              style={[styles.input, themeStyle('components_CarRentalEditForm_9', {  }, (theme ?? _styleTheme))]}
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
            <PayerSelect members={activeMembers} value={draft.paidBy} formatName={formatMemberDisplayName} onChange={ids => onChange((prev) => ({ ...prev, paidBy: ids }))} styles={styles} testID="car-rental-payer" />
          </ScrollView>
          <View style={[styles.tableFooter, themeStyle('components_CarRentalEditForm_10', {  }, (theme ?? _styleTheme))]}>
            <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={onCancel} testID="car-rental-cancel">
              <Text style={styles.dangerButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={onSave} testID="car-rental-save">
              <Text style={styles.buttonText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default CarRentalEditForm;
