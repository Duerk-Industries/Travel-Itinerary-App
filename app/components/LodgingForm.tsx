import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import PayerSelect from './PayerSelect';
import React, { memo, useMemo } from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import type { LodgingDraft } from '../tabs/lodging';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import { toWebStyle } from '../utils/webStyle';
import { DEFAULT_NEW_ITINERARY_STATUS, ITINERARY_STATUSES, normalizeItineraryStatus } from '../utils/itineraryStatus';

import DateField from './DateField';
import DraftTextInput from './DraftTextInput';

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
  theme?: AppTheme;
  isCompact: boolean;
};

const LodgingFormComponent: React.FC<LodgingFormProps> = ({
  draft,
  setDraft,
  groupMembers,
  formatMemberName,
  payerName,
  defaultPayerId,
  styles,
  theme: _providedTheme,
  isCompact,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const activeMembers = useMemo(
    () => groupMembers.filter((m) => m.status !== 'removed' && !m.removedAt),
    [groupMembers]
  );

  const updateTravelerIds = (nextIds: string[]) => {
    setDraft((prev) => ({ ...prev, travelerIds: nextIds.filter(Boolean) }));
  };

  const toggleBaseStyle = styles.toggleOption ?? themeStyle('components_LodgingForm_1', { theme: theme }, (theme ?? _styleTheme));
  const toggleSelectedStyle = styles.toggleOptionSelected ?? themeStyle('components_LodgingForm_2', { theme: theme }, (theme ?? _styleTheme));
  const toggleTextStyle = styles.toggleOptionText ?? themeStyle('components_LodgingForm_3', { theme: theme }, (theme ?? _styleTheme));
  const toggleTextSelectedStyle = styles.toggleOptionTextSelected ?? themeStyle('components_LodgingForm_4', { theme: theme }, (theme ?? _styleTheme));

  const renderDateInput = (
    field: 'checkIn' | 'checkOut' | 'refundBy',
    value: string,
    onChange: (next: string) => void
  ) => (
    <DateField
      value={value}
      onChange={onChange}
      styles={styles}
      theme={theme}
      testID={`lodging-${field === 'checkIn' ? 'check-in' : field === 'checkOut' ? 'check-out' : 'refund-by'}-date`}
      accessibilityLabel={`${field === 'checkIn' ? 'Check-in' : field === 'checkOut' ? 'Check-out' : 'Refund by'} date`}
    />
  );

  return (
    <>
      <View style={[styles.modalRow, isCompact && themeStyle('components_LodgingForm_5', {  }, (theme ?? _styleTheme))]}>
        <View style={[styles.modalField, isCompact && themeStyle('components_LodgingForm_6', {  }, (theme ?? _styleTheme))]}>
          <Text style={styles.modalLabel}>Status</Text>
          {Platform.OS === 'web' ? (
            <select
              value={normalizeItineraryStatus(draft.status, DEFAULT_NEW_ITINERARY_STATUS)}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, status: normalizeItineraryStatus(e.target.value, DEFAULT_NEW_ITINERARY_STATUS) }))
              }
              style={toWebStyle(styles.input, themeStyle('components_LodgingForm_7', {  }, (theme ?? _styleTheme)))}
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

      <View style={[styles.modalRow, isCompact && themeStyle('components_LodgingForm_8', {  }, (theme ?? _styleTheme))]}>
        <View style={[styles.modalField, isCompact && themeStyle('components_LodgingForm_9', {  }, (theme ?? _styleTheme))]}>
          <Text style={styles.modalLabel}>Name</Text>
          <DraftTextInput
            style={styles.input}
            placeholder="Hotel name"
            value={draft.name}
            onChangeText={(text: string) => setDraft((prev) => ({ ...prev, name: text }))}
            commitOnBlur={false}
          />
        </View>
        <View style={[styles.modalField, isCompact && themeStyle('components_LodgingForm_10', {  }, (theme ?? _styleTheme))]}>
          <Text style={styles.modalLabel}>Rooms</Text>
          <DraftTextInput
            style={styles.input}
            placeholder="1"
            keyboardType="numeric"
            value={draft.rooms}
            onChangeText={(text: string) => setDraft((prev) => ({ ...prev, rooms: text }))}
            commitOnBlur={false}
          />
        </View>
      </View>

      <View style={[styles.modalRow, isCompact && themeStyle('components_LodgingForm_11', {  }, (theme ?? _styleTheme))]}>
        <View style={[styles.modalField, isCompact && themeStyle('components_LodgingForm_12', {  }, (theme ?? _styleTheme))]}>
          <Text style={styles.modalLabel}>Check-in date</Text>
          {renderDateInput('checkIn', draft.checkInDate, (value) =>
            setDraft((prev) => ({ ...prev, checkInDate: value }))
          )}
        </View>
        <View style={[styles.modalField, isCompact && themeStyle('components_LodgingForm_13', {  }, (theme ?? _styleTheme))]}>
          <Text style={styles.modalLabel}>Check-out date</Text>
          {renderDateInput('checkOut', draft.checkOutDate, (value) =>
            setDraft((prev) => ({ ...prev, checkOutDate: value }))
          )}
        </View>
      </View>

      <View style={[styles.modalRow, isCompact && themeStyle('components_LodgingForm_14', {  }, (theme ?? _styleTheme))]}>
        <View style={[styles.modalField, isCompact && themeStyle('components_LodgingForm_15', {  }, (theme ?? _styleTheme))]}>
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
        <View style={[styles.modalField, isCompact && themeStyle('components_LodgingForm_16', {  }, (theme ?? _styleTheme))]}>
          <Text style={styles.modalLabel}>Total cost</Text>
          <DraftTextInput
            style={styles.input}
            placeholder="0.00"
            keyboardType="numeric"
            value={draft.totalCost}
            onChangeText={(text: string) =>
              setDraft((prev) => ({ ...prev, totalCost: sanitizeCostInput(text) }))
            }
            commitOnBlur={false}
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
          const name = formatMemberName(m);
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
      <PayerSelect members={activeMembers} value={draft.paidBy} formatName={formatMemberName} onChange={ids => setDraft((prev) => ({ ...prev, paidBy: ids }))} styles={styles} testID="lodging-payer" />

      <Text style={styles.modalLabel}>Address</Text>
      <DraftTextInput
        style={styles.input}
        placeholder="Address"
        value={draft.address}
        onChangeText={(text: string) => setDraft((prev) => ({ ...prev, address: text }))}
        commitOnBlur={false}
      />

      <Text style={styles.modalLabel}>Notes</Text>
      <DraftTextInput
        style={[styles.input, themeStyle('components_LodgingForm_17', {  }, (theme ?? _styleTheme))]}
        placeholder="Notes"
        value={draft.notes ?? ''}
        onChangeText={(text: string) => setDraft((prev) => ({ ...prev, notes: text }))}
        commitOnBlur={false}
        multiline
      />

      <Text style={styles.modalLabel}>Features</Text>
      <DraftTextInput
        style={styles.input}
        placeholder="Breakfast, Dinner, Laundry"
        value={(draft.features ?? []).join(', ')}
        onChangeText={(text: string) => setDraft((prev) => ({ ...prev, features: text.split(',').map((item) => item.trim()).filter(Boolean) }))}
        commitOnBlur={false}
      />
    </>
  );
};

const LodgingForm = memo(LodgingFormComponent);

export default LodgingForm;
