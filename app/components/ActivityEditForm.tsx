import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import PayerSelect from './PayerSelect';
import ActivityDescriptionGenerator from './ActivityDescriptionGenerator';
import React, { useMemo, useRef, useState } from 'react';
import SelectField from './SelectField';
import { localTodayDateOnly } from '../utils/dateOnly';
import type { Lodging } from '../../server/src/types';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Modal from './KeyboardAwareModal';
import { sanitizeCostInput } from '../utils/sanitizeCost';
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

export type ActivityFormLodging = Pick<Lodging, 'id' | 'name'> & {
  checkInDate?: Lodging['check_in_date'];
  checkOutDate?: Lodging['check_out_date'];
};

export type ActivityEditFormProps = {
  draft: TourDraft;
  lodgings?: ActivityFormLodging[];
  onChange: (updater: (prev: TourDraft) => TourDraft) => void;
  onSave: () => void | Promise<void>;
  onCancel: () => void;
  isNew: boolean;
  members: ActivityFormMember[];
  styles: Record<string, any>;
  theme?: AppTheme;
  /** Shown at the bottom of the form, below every field. */
  footer?: React.ReactNode;
};

const ActivityEditForm: React.FC<ActivityEditFormProps> = ({
  draft,
  lodgings = [],
  onChange,
  onSave,
  onCancel,
  isNew,
  footer,
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
  const labelStyle = [styles.modalLabel, themeStyle('components_ActivityEditForm_label', {  }, (theme ?? _styleTheme))];
  // Example text in an empty field reads as a hint, not as something already filled in.
  const placeholderColor = (theme ?? _styleTheme).colors.textMuted;


  const status = normalizeItineraryStatus(draft.status, DEFAULT_NEW_ITINERARY_STATUS);
  const activityType = draft.activityType || 'Tour';
  const [schedulingMode, setSchedulingMode] = useState<'scheduled' | 'optional'>(() => draft.date ? 'scheduled' : 'optional');
  const lastScheduledDate = useRef(draft.date || localTodayDateOnly());
  const hotelOptions = useMemo(() => [
    { value: '', label: 'No hotel — available every day' },
    ...[...lodgings].sort((a, b) =>
      (a.checkInDate || '9999').localeCompare(b.checkInDate || '9999') ||
      (a.checkOutDate || '9999').localeCompare(b.checkOutDate || '9999') ||
      a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    ).map((hotel) => ({ value: hotel.id, label: hotel.name || 'Hotel' })),
  ], [lodgings]);
  const changeSchedulingMode = (value: string) => {
    const optional = value === 'optional';
    if (draft.date) lastScheduledDate.current = draft.date;
    setSchedulingMode(optional ? 'optional' : 'scheduled');
    onChange((prev) => ({ ...prev, date: optional ? '' : lastScheduledDate.current }));
  };


  return (
    <Modal transparent visible animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalOverlay} testID="activity-form-modal">
        <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={onCancel} />
        <View style={[styles.modalCard, themeStyle('components_ActivityEditForm_5', {  }, (theme ?? _styleTheme))]}>
          <Text style={styles.sectionTitle}>{isNew ? (schedulingMode === 'scheduled' ? 'Add Activity' : 'Add Optional Activity') : 'Edit Activity'}</Text>
          <ScrollView style={themeStyle('components_ActivityEditForm_6', {  }, (theme ?? _styleTheme))} contentContainerStyle={themeStyle('components_ActivityEditForm_7', {  }, (theme ?? _styleTheme))} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            <View style={themeStyle('components_ActivityEditForm_layout1', {  }, (theme ?? _styleTheme))} testID="activity-scheduling-row">
              <View style={themeStyle('components_ActivityEditForm_layout2', {  }, (theme ?? _styleTheme))}>
                <Text style={labelStyle}>Scheduling</Text>
                <SelectField title="Activity scheduling" testID="activity-scheduling" value={schedulingMode === 'optional' ? 'optional' : ''}
                  options={[{ value: '', label: 'Scheduled' }, { value: 'optional', label: 'Optional' }]}
                  onChange={changeSchedulingMode} styles={styles} style={themeStyle('components_ActivityEditForm_layout3', {  }, (theme ?? _styleTheme))} webStyle={themeStyle('components_ActivityEditForm_layout3', {  }, (theme ?? _styleTheme))} />
              </View>
              <View style={themeStyle('components_ActivityEditForm_layout4', {  }, (theme ?? _styleTheme))}>
                <Text style={labelStyle}>{schedulingMode === 'optional' ? 'Near hotel' : 'Date'}</Text>
                {schedulingMode === 'optional' ? <SelectField title="Near hotel" testID="activity-near-hotel"
                  value={draft.nearLodgingId ?? ''} options={hotelOptions} styles={styles}
                  style={themeStyle('components_ActivityEditForm_layout3', {  }, (theme ?? _styleTheme))} webStyle={themeStyle('components_ActivityEditForm_layout3', {  }, (theme ?? _styleTheme))}
                  onChange={(id) => onChange((prev) => ({ ...prev, nearLodgingId: id || null }))} /> : <DateField
                  value={draft.date} onChange={(date) => { if (date) lastScheduledDate.current = date; onChange((prev) => ({ ...prev, date })); }}
                  styles={styles} theme={theme} testID="activity-date" accessibilityLabel="Activity date" style={themeStyle('components_ActivityEditForm_layout3', {  }, (theme ?? _styleTheme))}
                />}
              </View>
            </View>
            <Text style={labelStyle}>Status</Text>
            <SelectField title="Status" testID="activity-status" sheet value={status} styles={styles}
              options={ITINERARY_STATUSES.map((opt) => ({ value: opt, label: opt }))}
              onChange={(value) => onChange((prev) => ({ ...prev, status: normalizeItineraryStatus(value, DEFAULT_NEW_ITINERARY_STATUS) }))} />
            <Text style={labelStyle}>Activity Type</Text>
            <SelectField title="Activity type" testID="activity-type" sheet value={activityType} styles={styles}
              options={ACTIVITY_TYPES.map((opt) => ({ value: opt, label: opt }))}
              onChange={(value) => onChange((prev) => ({ ...prev, activityType: ACTIVITY_TYPES.includes(value as ActivityType) ? (value as ActivityType) : 'Tour' }))} />
            <Text style={labelStyle}>Activity</Text>
            <TextInput
              style={styles.input}
              placeholder="Activity name"
              placeholderTextColor={placeholderColor}
              value={draft.name}
              onChangeText={(text: string) => onChange((prev) => ({ ...prev, name: text }))}
            />
            <Text style={labelStyle}>Start location</Text>
            <TextInput
              style={styles.input}
              placeholder="Start location"
              placeholderTextColor={placeholderColor}
              value={draft.startLocation}
              onChangeText={(text: string) => onChange((prev) => ({ ...prev, startLocation: text }))}
            />
            <Text style={labelStyle}>Start time</Text>
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
            <Text style={labelStyle}>Duration</Text>
            <TextInput
              style={styles.input}
              placeholder="Duration"
              placeholderTextColor={placeholderColor}
              value={draft.duration}
              onChangeText={(text: string) => onChange((prev) => ({ ...prev, duration: text }))}
            />
            <Text style={labelStyle}>Cost</Text>
            <TextInput
              style={styles.input}
              placeholder="Cost"
              placeholderTextColor={placeholderColor}
              keyboardType="decimal-pad"
              value={draft.cost}
              onChangeText={(text: string) => onChange((prev) => ({ ...prev, cost: sanitizeCostInput(text) }))}
            />
            <Text style={labelStyle}>Free cancellation by</Text>
            <View style={themeStyle('components_ActivityEditForm_clearRow', {  }, (theme ?? _styleTheme))}>
              <View style={themeStyle('components_ActivityEditForm_layout4', {  }, (theme ?? _styleTheme))}>
                <DateField
                  value={draft.freeCancelBy}
                  onChange={(freeCancelBy) => onChange((prev) => ({ ...prev, freeCancelBy }))}
                  styles={styles}
                  theme={theme}
                  testID="activity-free-cancellation-date"
                  accessibilityLabel="Free cancellation by date"
                />
              </View>
              {draft.freeCancelBy ? (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear free cancellation date" testID="activity-free-cancellation-clear"
                  hitSlop={8} style={themeStyle('components_ActivityEditForm_clearButton', {  }, (theme ?? _styleTheme))} onPress={() => onChange((prev) => ({ ...prev, freeCancelBy: '' }))}>
                  <Text style={styles.linkText}>Clear</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <Text style={labelStyle}>Platform Booked On</Text>
            <View style={themeStyle('components_ActivityEditForm_10', {  }, (theme ?? _styleTheme))}>
              <TextInput
                style={[styles.input, themeStyle('components_ActivityEditForm_11', {  }, (theme ?? _styleTheme))]}
                placeholder="Viator, GetYourGuide, Klook, etc."
                placeholderTextColor={placeholderColor}
                value={draft.bookedOn}
                onChangeText={(text: string) => onChange((prev) => ({ ...prev, bookedOn: text }))}
              />
              <TextInput
                style={[styles.input, themeStyle('components_ActivityEditForm_12', {  }, (theme ?? _styleTheme))]}
                placeholder="Reference"
                placeholderTextColor={placeholderColor}
                value={draft.reference}
                onChangeText={(text: string) => onChange((prev) => ({ ...prev, reference: text }))}
              />
            </View>
            <Text style={labelStyle}>Description</Text>
            <TextInput
              style={[styles.input, themeStyle('components_ActivityEditForm_13', {  }, (theme ?? _styleTheme))]}
              placeholder="Description"
              placeholderTextColor={placeholderColor}
              value={draft.notes}
              onChangeText={(text: string) => onChange((prev) => ({ ...prev, notes: text }))}
              multiline
            />
            <ActivityDescriptionGenerator
              key={JSON.stringify([draft.name, draft.startLocation, draft.date])}
              input={{ name: draft.name, location: draft.startLocation, notes: draft.notes }}
              styles={styles} onApply={notes => onChange(previous => ({ ...previous, notes: previous.notes.trim() ? `${previous.notes.trimEnd()}\n\n${notes}` : notes }))} />
            <Text style={labelStyle}>Participants</Text>
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
            <Text style={labelStyle}>Paid by</Text>
            <PayerSelect members={activeMembers} value={draft.paidBy} formatName={formatMemberDisplayName} onChange={ids => onChange((prev) => ({ ...prev, paidBy: ids }))} styles={styles} testID="activity-payer" />
            {footer}
          </ScrollView>
          <View style={[styles.tableFooter, themeStyle('components_ActivityEditForm_14', {  }, (theme ?? _styleTheme))]}>
            <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={onCancel} testID="activity-cancel">
              <Text style={styles.dangerButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={onSave} disabled={schedulingMode === 'scheduled' && !draft.date} testID="activity-save">
              <Text style={styles.buttonText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default ActivityEditForm;
