import React, { useState } from 'react';
import { Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { formatDateLong } from '../utils/formatDateLong';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import { toWebStyle } from '../utils/webStyle';
import { formatMemberDisplayName } from '../utils/memberDisplay';
import type { AppTheme } from '../theme/theme';
import { DEFAULT_NEW_ITINERARY_STATUS, ITINERARY_STATUSES, normalizeItineraryStatus } from '../utils/itineraryStatus';
import { ACTIVITY_TYPES, type ActivityType, type TourDraft } from '../tabs/activities';
import NativeDatePickerSheet from './NativeDatePickerSheet';

// Single source of truth for the "add/edit activity" form so the Activities tab and the
// Overview day-detail "quick edit" share one implementation instead of two hand-copied
// forms that can drift out of sync with each other as fields get added over time.

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

export type ActivityFormMember = {
  id: string;
  guestName?: string;
  email?: string;
  userEmail?: string;
  firstName?: string;
  lastName?: string;
  status?: 'active' | 'pending' | 'removed';
  removedAt?: string | null;
};

type ActivityDateField = 'date' | 'startTime' | 'freeCancel';

export type ActivityEditFormProps = {
  draft: TourDraft;
  onChange: (updater: (prev: TourDraft) => TourDraft) => void;
  onSave: () => void | Promise<void>;
  onCancel: () => void;
  isNew: boolean;
  members: ActivityFormMember[];
  styles: Record<string, any>;
  theme?: AppTheme;
};

const ActivityEditForm: React.FC<ActivityEditFormProps> = ({
  draft,
  onChange,
  onSave,
  onCancel,
  isNew,
  members,
  styles,
  theme,
}) => {
  const [dateField, setDateField] = useState<ActivityDateField | null>(null);
  const [pickerValue, setPickerValue] = useState<Date>(new Date());

  const activeMembers = members.filter((m) => m.status !== 'removed' && !m.removedAt);

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

  const openDatePicker = (field: ActivityDateField) => {
    setDateField(field);
    const current = field === 'date' ? draft.date : field === 'startTime' ? draft.startTime : draft.freeCancelBy;
    if (field === 'startTime') {
      const base = new Date();
      if (current && /^\d{1,2}:\d{2}/.test(current)) {
        const [h, m] = current.split(':').map(Number);
        if (!Number.isNaN(h) && !Number.isNaN(m)) {
          base.setHours(h, m, 0, 0);
        }
      }
      setPickerValue(base);
    } else {
      setPickerValue(current ? new Date(current) : new Date());
    }
  };

  const status = normalizeItineraryStatus(draft.status, DEFAULT_NEW_ITINERARY_STATUS);
  const activityType = draft.activityType || 'Tour';

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalOverlay} testID="activity-form-modal">
        <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={onCancel} />
        <View style={[styles.modalCard, { marginTop: 0 }]}>
          <Text style={styles.sectionTitle}>{isNew ? 'Add Activity' : 'Edit Activity'}</Text>
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingRight: 12 }}>
            <Text style={styles.modalLabel}>Date</Text>
            {Platform.OS === 'web' ? (
              <input
                style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
                type="date"
                title="Activity date"
                value={draft.date}
                onChange={(e) => onChange((prev) => ({ ...prev, date: e.target.value }))}
              />
            ) : (
              <TouchableOpacity style={styles.input} onPress={() => openDatePicker('date')}>
                <Text style={styles.cellText}>{formatDateLong(draft.date)}</Text>
              </TouchableOpacity>
            )}
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
                      key={`tour-status-${opt}`}
                      style={[toggleBaseStyle, selected && toggleSelectedStyle]}
                      onPress={() => onChange((prev) => ({ ...prev, status: opt }))}
                    >
                      <Text style={[toggleTextStyle, selected && toggleTextSelectedStyle]}>{opt}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            <Text style={styles.modalLabel}>Activity Type</Text>
            {Platform.OS === 'web' ? (
              <select
                value={activityType}
                onChange={(e) =>
                  onChange((prev) => ({
                    ...prev,
                    activityType: ACTIVITY_TYPES.includes(e.target.value as ActivityType) ? (e.target.value as ActivityType) : 'Tour',
                  }))
                }
                style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
              >
                {ACTIVITY_TYPES.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <View style={styles.payerChips}>
                {ACTIVITY_TYPES.map((opt) => {
                  const selected = activityType === opt;
                  return (
                    <TouchableOpacity
                      key={`activity-type-${opt}`}
                      style={[toggleBaseStyle, selected && toggleSelectedStyle]}
                      onPress={() => onChange((prev) => ({ ...prev, activityType: opt }))}
                    >
                      <Text style={[toggleTextStyle, selected && toggleTextSelectedStyle]}>{opt}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            <Text style={styles.modalLabel}>Activity</Text>
            <TextInput
              style={styles.input}
              placeholder="Activity name"
              value={draft.name}
              onChangeText={(text: string) => onChange((prev) => ({ ...prev, name: text }))}
            />
            <Text style={styles.modalLabel}>Start location</Text>
            <TextInput
              style={styles.input}
              placeholder="Start location"
              value={draft.startLocation}
              onChangeText={(text: string) => onChange((prev) => ({ ...prev, startLocation: text }))}
            />
            <Text style={styles.modalLabel}>Start time</Text>
            {Platform.OS === 'web' ? (
              <input
                style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
                type="time"
                title="Start time"
                value={draft.startTime}
                onChange={(e) => onChange((prev) => ({ ...prev, startTime: e.target.value }))}
              />
            ) : (
              <TouchableOpacity style={styles.input} onPress={() => openDatePicker('startTime')}>
                <Text style={styles.cellText}>{draft.startTime || 'Select time'}</Text>
              </TouchableOpacity>
            )}
            <Text style={styles.modalLabel}>Duration</Text>
            <TextInput
              style={styles.input}
              placeholder="Duration"
              value={draft.duration}
              onChangeText={(text: string) => onChange((prev) => ({ ...prev, duration: text }))}
            />
            <Text style={styles.modalLabel}>Cost</Text>
            <TextInput
              style={styles.input}
              placeholder="Cost"
              keyboardType="numeric"
              value={draft.cost}
              onChangeText={(text: string) => onChange((prev) => ({ ...prev, cost: sanitizeCostInput(text) }))}
            />
            <View style={styles.modalRow}>
              <Text style={styles.modalLabel}>Free cancellation by</Text>
              <TouchableOpacity onPress={() => onChange((prev) => ({ ...prev, freeCancelBy: '' }))}>
                <Text style={styles.linkText}>Clear</Text>
              </TouchableOpacity>
            </View>
            {Platform.OS === 'web' ? (
              <input
                style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
                type="date"
                title="Free cancellation by date"
                value={draft.freeCancelBy}
                onChange={(e) => onChange((prev) => ({ ...prev, freeCancelBy: e.target.value }))}
              />
            ) : (
              <TouchableOpacity style={styles.input} onPress={() => openDatePicker('freeCancel')}>
                <Text style={styles.cellText}>{draft.freeCancelBy ? formatDateLong(draft.freeCancelBy) : 'Select date'}</Text>
              </TouchableOpacity>
            )}
            <Text style={styles.modalLabel}>Platform Booked On</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <TextInput
                style={[styles.input, { flex: 1, minWidth: 220 }]}
                placeholder="Viator, Get Your Guide, Klook, etc."
                value={draft.bookedOn}
                onChangeText={(text: string) => onChange((prev) => ({ ...prev, bookedOn: text }))}
              />
              <TextInput
                style={[styles.input, { flex: 1, minWidth: 220 }]}
                placeholder="Reference"
                value={draft.reference}
                onChangeText={(text: string) => onChange((prev) => ({ ...prev, reference: text }))}
              />
            </View>
            <Text style={styles.modalLabel}>Description</Text>
            <TextInput
              style={[styles.input, { minHeight: 96, textAlignVertical: 'top' }]}
              placeholder="Description"
              value={draft.notes}
              onChangeText={(text: string) => onChange((prev) => ({ ...prev, notes: text }))}
              multiline
            />
            <Text style={styles.modalLabel}>Participants</Text>
            <View style={styles.payerChips}>
              {activeMembers.map((m) => {
                const selected = (draft.travelerIds ?? []).includes(m.id);
                const name = formatMemberDisplayName(m);
                return (
                  <TouchableOpacity
                    key={`tour-participant-${m.id}`}
                    style={[toggleBaseStyle, selected && toggleSelectedStyle]}
                    onPress={() =>
                      onChange((prev) => {
                        const current = prev.travelerIds ?? [];
                        const next = selected ? current.filter((id) => id !== m.id) : [...current, m.id];
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
                    key={`tour-payer-${m.id}`}
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
            <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={onCancel} testID="activity-cancel">
              <Text style={styles.dangerButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={onSave} testID="activity-save">
              <Text style={styles.buttonText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      {Platform.OS !== 'web' && NativeDateTimePicker ? (
        <NativeDatePickerSheet
          visible={!!dateField}
          onRequestClose={() => setDateField(null)}
          theme={theme}
          testID="activity-date-picker"
        >
          <NativeDateTimePicker
            value={pickerValue}
            mode={dateField === 'startTime' ? 'time' : 'date'}
            onChange={(_, date) => {
              if (!date) {
                setDateField(null);
                return;
              }
              const iso = date.toISOString().slice(0, 10);
              onChange((prev) => {
                if (dateField === 'startTime') {
                  const hours = String(date.getHours()).padStart(2, '0');
                  const mins = String(date.getMinutes()).padStart(2, '0');
                  return { ...prev, startTime: `${hours}:${mins}` };
                }
                if (dateField === 'date') return { ...prev, date: iso };
                return { ...prev, freeCancelBy: iso };
              });
              setDateField(null);
            }}
          />
        </NativeDatePickerSheet>
      ) : null}
    </Modal>
  );
};

export default ActivityEditForm;
