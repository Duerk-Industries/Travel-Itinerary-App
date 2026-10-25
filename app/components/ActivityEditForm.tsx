import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import PayerSelect from './PayerSelect';
import ActivityDescriptionGenerator from './ActivityDescriptionGenerator';
import React from 'react';
import { Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Modal from './KeyboardAwareModal';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import { toWebStyle } from '../utils/webStyle';
import { formatMemberDisplayName } from '../utils/memberDisplay';

import { DEFAULT_NEW_ITINERARY_STATUS, ITINERARY_STATUSES, normalizeItineraryStatus } from '../utils/itineraryStatus';
import { ACTIVITY_TYPES, type ActivityType } from '../utils/activityTypes';
import type { TourDraft } from '../tabs/activities';
import DateField from './DateField';

// Single source of truth for the "add/edit activity" form so the Activities tab and the
// Overview day-detail "quick edit" share one implementation instead of two hand-copied
// forms that can drift out of sync with each other as fields get added over time.

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
  theme: _providedTheme,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const activeMembers = members.filter((m) => m.status !== 'removed' && !m.removedAt);

  const toggleBaseStyle = styles.toggleOption ?? themeStyle('components_ActivityEditForm_1', { theme: theme }, (theme ?? _styleTheme));
  const toggleSelectedStyle = styles.toggleOptionSelected ?? themeStyle('components_ActivityEditForm_2', { theme: theme }, (theme ?? _styleTheme));
  const toggleTextStyle = styles.toggleOptionText ?? themeStyle('components_ActivityEditForm_3', { theme: theme }, (theme ?? _styleTheme));
  const toggleTextSelectedStyle = styles.toggleOptionTextSelected ?? themeStyle('components_ActivityEditForm_4', { theme: theme }, (theme ?? _styleTheme));


  const status = normalizeItineraryStatus(draft.status, DEFAULT_NEW_ITINERARY_STATUS);
  const activityType = draft.activityType || 'Tour';

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalOverlay} testID="activity-form-modal">
        <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={onCancel} />
        <View style={[styles.modalCard, themeStyle('components_ActivityEditForm_5', {  }, (theme ?? _styleTheme))]}>
          <Text style={styles.sectionTitle}>{isNew ? 'Add Activity' : 'Edit Activity'}</Text>
          <ScrollView style={themeStyle('components_ActivityEditForm_6', {  }, (theme ?? _styleTheme))} contentContainerStyle={themeStyle('components_ActivityEditForm_7', {  }, (theme ?? _styleTheme))} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            <Text style={styles.modalLabel}>Date</Text>
            <DateField
              value={draft.date}
              onChange={(date) => onChange((prev) => ({ ...prev, date }))}
              styles={styles}
              theme={theme}
              testID="activity-date"
              accessibilityLabel="Activity date"
            />
            <Text style={styles.modalLabel}>Status</Text>
            {Platform.OS === 'web' ? (
              <select
                value={status}
                onChange={(e) => onChange((prev) => ({ ...prev, status: normalizeItineraryStatus(e.target.value, DEFAULT_NEW_ITINERARY_STATUS) }))}
                style={toWebStyle(styles.input, themeStyle('components_ActivityEditForm_8', {  }, (theme ?? _styleTheme)))}
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
                style={toWebStyle(styles.input, themeStyle('components_ActivityEditForm_9', {  }, (theme ?? _styleTheme)))}
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
            <DateField
              mode="time"
              value={draft.startTime}
              onChange={(startTime) => onChange((prev) => ({ ...prev, startTime }))}
              styles={styles}
              theme={theme}
              placeholder="Select time"
              testID="activity-start-time"
              accessibilityLabel="Start time"
            />
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
            <DateField
              value={draft.freeCancelBy}
              onChange={(freeCancelBy) => onChange((prev) => ({ ...prev, freeCancelBy }))}
              styles={styles}
              theme={theme}
              testID="activity-free-cancellation-date"
              accessibilityLabel="Free cancellation by date"
            />
            <Text style={styles.modalLabel}>Platform Booked On</Text>
            <View style={themeStyle('components_ActivityEditForm_10', {  }, (theme ?? _styleTheme))}>
              <TextInput
                style={[styles.input, themeStyle('components_ActivityEditForm_11', {  }, (theme ?? _styleTheme))]}
                placeholder="Viator, Get Your Guide, Klook, etc."
                value={draft.bookedOn}
                onChangeText={(text: string) => onChange((prev) => ({ ...prev, bookedOn: text }))}
              />
              <TextInput
                style={[styles.input, themeStyle('components_ActivityEditForm_12', {  }, (theme ?? _styleTheme))]}
                placeholder="Reference"
                value={draft.reference}
                onChangeText={(text: string) => onChange((prev) => ({ ...prev, reference: text }))}
              />
            </View>
            <Text style={styles.modalLabel}>Description</Text>
            <TextInput
              style={[styles.input, themeStyle('components_ActivityEditForm_13', {  }, (theme ?? _styleTheme))]}
              placeholder="Description"
              value={draft.notes}
              onChangeText={(text: string) => onChange((prev) => ({ ...prev, notes: text }))}
              multiline
            />
            <ActivityDescriptionGenerator
              key={JSON.stringify([draft.name, draft.startLocation, draft.date])}
              input={{ name: draft.name, location: draft.startLocation, notes: draft.notes }}
              styles={styles} onApply={notes => onChange(previous => ({ ...previous, notes: previous.notes.trim() ? `${previous.notes.trimEnd()}\n\n${notes}` : notes }))} />
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
            <PayerSelect members={activeMembers} value={draft.paidBy} formatName={formatMemberDisplayName} onChange={ids => onChange((prev) => ({ ...prev, paidBy: ids }))} styles={styles} testID="activity-payer" />
          </ScrollView>
          <View style={[styles.tableFooter, themeStyle('components_ActivityEditForm_14', {  }, (theme ?? _styleTheme))]}>
            <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={onCancel} testID="activity-cancel">
              <Text style={styles.dangerButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={onSave} testID="activity-save">
              <Text style={styles.buttonText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default ActivityEditForm;
