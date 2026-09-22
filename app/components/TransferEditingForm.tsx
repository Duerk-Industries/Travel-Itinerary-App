import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { formatDateLong } from '../utils/formatDateLong';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import type { FlightEditDraft, GroupMemberOption, TransferType } from '../tabs/transfers';
import { toWebStyle } from '../utils/webStyle';
import { DEFAULT_NEW_ITINERARY_STATUS, ITINERARY_STATUSES, normalizeItineraryStatus } from '../utils/itineraryStatus';
import type { AppTheme } from '../theme/theme';
import NativeDatePickerSheet from './NativeDatePickerSheet';

type AirportTarget = 'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover' | null;
const TRANSFER_TYPES: TransferType[] = ['Flight', 'Train', 'Bus', 'Private', 'Ferry', 'Other'];

export type FlightEditingFormProps = {
  visible: boolean;
  flightId: string | null;
  flight: FlightEditDraft | null;
  overlayStyle?: Record<string, any>;
  cardStyle?: Record<string, any>;
  airportAnchor?: { x: number; y: number; width: number; height: number } | null;
  airportTarget?: AirportTarget | null;
  airportSuggestions?: Array<{ iata_code?: string; name: string; city?: string; country?: string }>;
  formatAirportLabel?: (airport: { iata_code?: string; name: string; city?: string; country?: string }) => string;
  onHideAirportDropdown?: () => void;
  onSelectAirport?: (target: Exclude<AirportTarget, null>, airport: any) => void;
  // Fired on press-in (before the field's onBlur can fire) so the parent can suppress its
  // blur-triggered auto-select just long enough for the actual click to land — see the callsite
  // in transfers.tsx for the full explanation.
  onAirportOptionPressIn?: () => void;
  groupMembers: GroupMemberOption[];
  userMembers: GroupMemberOption[];
  styles: Record<string, any>;
  theme?: AppTheme;
  formatMemberName: (member: GroupMemberOption) => string;
  payerName: (id: string) => string;
  getLocationInputValue: (raw: string, activeTarget: AirportTarget, currentTarget: AirportTarget) => string;
  showAirportDropdown: (target: Exclude<AirportTarget, null>, node: any, query: string) => void;
  parseLayoverDuration: (value: string | null | undefined) => { hours: string; minutes: string };
  openTimePicker: (target: 'edit-dep' | 'edit-arr' | 'new-dep' | 'new-arr', current: string) => void;
  // Rendered inside this component's own Modal (see below) rather than by the caller — a native
  // RN Modal presents in its own window above everything else, so a time picker rendered by the
  // caller as a sibling outside this Modal would be mounted but invisible, hidden behind it.
  timePickerTarget?: 'edit-dep' | 'edit-arr' | null;
  timePickerValue?: Date;
  onTimePickerChange?: (event: { type?: string } | undefined, date: Date | undefined, target: 'edit-dep' | 'edit-arr' | 'new-dep' | 'new-arr' | null) => void;
  nativeDateTimePicker?: React.ComponentType<any> | null;
  onAirportEnter: (target: Exclude<AirportTarget, null>, value: string) => void;
  setFlight: React.Dispatch<React.SetStateAction<FlightEditDraft | null>>;
  setPassengerIds: (ids: string[]) => void;
  modalDepLocationRef: React.RefObject<React.ElementRef<typeof TextInput> | null>;
  modalArrLocationRef: React.RefObject<React.ElementRef<typeof TextInput> | null>;
  modalLayoverLocationRef: React.RefObject<React.ElementRef<typeof TextInput> | null>;
  onClose: () => void;
  onSave: () => void;
};

export const FlightEditingForm: React.FC<FlightEditingFormProps> = ({
  visible,
  flightId,
  flight,
  overlayStyle,
  cardStyle,
  airportAnchor,
  airportTarget,
  airportSuggestions = [],
  formatAirportLabel,
  onHideAirportDropdown,
  onSelectAirport,
  onAirportOptionPressIn,
  groupMembers,
  userMembers,
  styles,
  theme,
  formatMemberName,
  payerName,
  airportTarget: activeAirportTarget,
  getLocationInputValue,
  showAirportDropdown,
  parseLayoverDuration,
  openTimePicker,
  timePickerTarget,
  timePickerValue,
  onTimePickerChange,
  nativeDateTimePicker: NativeDateTimePicker,
  onAirportEnter,
  setFlight,
  setPassengerIds,
  modalDepLocationRef,
  modalArrLocationRef,
  modalLayoverLocationRef,
  onClose,
  onSave,
}) => {
  if (!visible || !flight || !flightId) return null;

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
  const rowStyle = [styles.modalRow, { flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }];
  const fieldStyle = [styles.modalField, { minWidth: 200, flex: 1 }];
  const dateFieldStyle = [styles.modalField, { flexGrow: 0, flexShrink: 0, flexBasis: 190, minWidth: 190, maxWidth: 240 }];
  const timeFieldStyle = [styles.modalField, { flexGrow: 0, flexShrink: 0, flexBasis: 180, minWidth: 180, maxWidth: 220 }];
  const locationFieldStyle = [styles.modalField, { minWidth: 240, flexGrow: 1, flexBasis: 0 }];

  const baseOverlayStyle = {
    backgroundColor: 'rgba(15,23,42,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  };
  const baseCardStyle = { marginTop: 0 };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={[styles.passengerOverlay, baseOverlayStyle, overlayStyle]}>
        <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={onClose} />
        <View style={[styles.modalCard, baseCardStyle, cardStyle]}>
        <Text style={styles.sectionTitle}>Transfer Details</Text>
        <Text style={styles.helperText}>
          Current Departure: {formatDateLong(flight.departureDate)} at {flight.departureTime || '?'}
        </Text>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flexShrink: 1 }}
        >
        <ScrollView
          style={{ maxHeight: 420 }}
          contentContainerStyle={{ paddingRight: 12, paddingBottom: 8 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          nestedScrollEnabled
          contentInsetAdjustmentBehavior="automatic"
        >
          <Text style={styles.modalLabel}>Passengers</Text>
          <View style={styles.payerChips}>
            {groupMembers.map((m) => {
              const selected = flight.passengerIds.includes(m.id);
              const name = formatMemberName(m);
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[toggleBaseStyle, selected && toggleSelectedStyle]}
                  onPress={() => {
                    const next = selected ? flight.passengerIds.filter((id) => id !== m.id) : [...flight.passengerIds, m.id];
                    setPassengerIds(next);
                  }}
                >
                  <Text style={[toggleTextStyle, selected && toggleTextSelectedStyle]}>{name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[styles.modalLabel, { marginTop: 16 }]}>Status</Text>
          {Platform.OS === 'web' ? (
            <select
              value={normalizeItineraryStatus(flight.status, DEFAULT_NEW_ITINERARY_STATUS)}
              onChange={(e) => setFlight((prev) => (prev ? { ...prev, status: normalizeItineraryStatus(e.target.value, DEFAULT_NEW_ITINERARY_STATUS) } : prev))}
              style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
            >
              {ITINERARY_STATUSES.map((opt) => (
                <option key={`flight-status-${opt}`} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <View style={styles.payerChips}>
              {ITINERARY_STATUSES.map((opt) => {
                const selected = normalizeItineraryStatus(flight.status, DEFAULT_NEW_ITINERARY_STATUS) === opt;
                return (
                  <TouchableOpacity
                    key={`flight-status-${opt}`}
                    style={[toggleBaseStyle, selected && toggleSelectedStyle]}
                    onPress={() => setFlight((prev) => (prev ? { ...prev, status: opt } : prev))}
                  >
                    <Text style={[toggleTextStyle, selected && toggleTextSelectedStyle]}>{opt}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          <Text style={[styles.modalLabel, { marginTop: 16 }]}>Type</Text>
          {Platform.OS === 'web' ? (
            <select
              value={TRANSFER_TYPES.includes((flight as any).transferType as TransferType) ? (flight as any).transferType : 'Flight'}
              onChange={(e) =>
                setFlight((prev) =>
                  prev
                    ? {
                        ...prev,
                        transferType: TRANSFER_TYPES.includes(e.target.value as TransferType)
                          ? (e.target.value as TransferType)
                          : 'Flight',
                      }
                    : prev
                )
              }
              style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
            >
              {TRANSFER_TYPES.map((opt) => (
                <option key={`transfer-type-${opt}`} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <View style={styles.payerChips}>
              {TRANSFER_TYPES.map((opt) => {
                const selected = (flight as any).transferType === opt;
                return (
                  <TouchableOpacity
                    key={`transfer-type-${opt}`}
                    style={[toggleBaseStyle, selected && toggleSelectedStyle]}
                    onPress={() => setFlight((prev) => (prev ? { ...prev, transferType: opt } : prev))}
                  >
                    <Text style={[toggleTextStyle, selected && toggleTextSelectedStyle]}>{opt}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          <Text style={[styles.modalLabel, { marginTop: 16 }]}>Departure</Text>
          <View style={rowStyle}>
            <View style={dateFieldStyle}>
              <Text style={styles.modalLabelSmall}>Date</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={flight.departureDate}
                  onChange={(e) =>
                    setFlight((prev) => {
                      if (!prev) return prev;
                      const dep = e.target.value;
                      const nextArrival = !prev.arrivalDate || prev.arrivalDate === prev.departureDate ? dep : prev.arrivalDate;
                      return { ...prev, departureDate: dep, arrivalDate: nextArrival };
                    })
                  }
                  style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
                />
              ) : (
                <TextInput
                  style={styles.input}
                  value={flight.departureDate}
                  placeholder="Date"
                  onChangeText={(text: string) =>
                    setFlight((prev) => {
                      if (!prev) return prev;
                      const dep = text;
                      const nextArrival = !prev.arrivalDate || prev.arrivalDate === prev.departureDate ? dep : prev.arrivalDate;
                      return { ...prev, departureDate: dep, arrivalDate: nextArrival };
                    })
                  }
                />
              )}
            </View>
            <View style={timeFieldStyle}>
              <Text style={styles.modalLabelSmall}>Time</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="time"
                  value={flight.departureTime}
                  onChange={(e) => setFlight((prev) => (prev ? { ...prev, departureTime: e.target.value } : prev))}
                  style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
                />
              ) : (
                <TouchableOpacity
                  style={[styles.input, { justifyContent: 'center' }]}
                  onPress={() => openTimePicker('edit-dep', flight.departureTime)}
                >
                  <Text style={styles.cellText}>{flight.departureTime || 'HH:MM'}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          <View style={rowStyle}>
            <View style={locationFieldStyle}>
              <Text style={styles.modalLabelSmall}>Location</Text>
              <TextInput
                style={styles.input}
                testID="flight-modal-departure-location"
                value={getLocationInputValue(flight.departureLocation, 'modal-dep', activeAirportTarget ?? null)}
                placeholder="Location"
                ref={modalDepLocationRef}
                onFocus={() => showAirportDropdown('modal-dep', modalDepLocationRef.current, flight.departureLocation)}
                onChangeText={(text: string) => {
                  setFlight((prev) => (prev ? { ...prev, departureLocation: text } : prev));
                  showAirportDropdown('modal-dep', modalDepLocationRef.current, text);
                }}
                onKeyPress={(e: any) => {
                  if (e?.nativeEvent?.key === 'Enter' || e?.nativeEvent?.key === 'Tab') {
                    onAirportEnter('modal-dep', flight.departureLocation);
                  }
                }}
                onBlur={() => {
                  onAirportEnter('modal-dep', flight.departureLocation);
                }}
              />
            </View>
          </View>
          <Text style={[styles.modalLabel, { marginTop: 16 }]}>Arrival</Text>
          <View style={rowStyle}>
            <View style={dateFieldStyle}>
              <Text style={styles.modalLabelSmall}>Date</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={flight.arrivalDate}
                  onChange={(e) => setFlight((prev) => (prev ? { ...prev, arrivalDate: e.target.value } : prev))}
                  style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
                />
              ) : (
                <TextInput
                  style={styles.input}
                  value={flight.arrivalDate}
                  onChangeText={(text: string) => setFlight((prev) => (prev ? { ...prev, arrivalDate: text } : prev))}
                  placeholder="YYYY-MM-DD"
                />
              )}
            </View>
            <View style={timeFieldStyle}>
              <Text style={styles.modalLabelSmall}>Time</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="time"
                  value={flight.arrivalTime}
                  onChange={(e) => setFlight((prev) => (prev ? { ...prev, arrivalTime: e.target.value } : prev))}
                  style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
                />
              ) : (
                <TouchableOpacity
                  style={[styles.input, { justifyContent: 'center' }]}
                  onPress={() => openTimePicker('edit-arr', flight.arrivalTime)}
                >
                  <Text style={styles.cellText}>{flight.arrivalTime || 'HH:MM'}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          <View style={rowStyle}>
            <View style={locationFieldStyle}>
              <Text style={styles.modalLabelSmall}>Location</Text>
              <TextInput
                style={styles.input}
                testID="flight-modal-arrival-location"
                value={getLocationInputValue(flight.arrivalLocation, 'modal-arr', activeAirportTarget ?? null)}
                placeholder="Location"
                ref={modalArrLocationRef}
                onFocus={() => showAirportDropdown('modal-arr', modalArrLocationRef.current, flight.arrivalLocation)}
                onChangeText={(text: string) => {
                  setFlight((prev) => (prev ? { ...prev, arrivalLocation: text } : prev));
                  showAirportDropdown('modal-arr', modalArrLocationRef.current, text);
                }}
                onKeyPress={(e: any) => {
                  if (e?.nativeEvent?.key === 'Enter' || e?.nativeEvent?.key === 'Tab') {
                    onAirportEnter('modal-arr', flight.arrivalLocation);
                  }
                }}
                onBlur={() => {
                  onAirportEnter('modal-arr', flight.arrivalLocation);
                }}
              />
            </View>
          </View>

          <Text style={[styles.modalLabel, { marginTop: 16 }]}>Layover</Text>
          <View style={rowStyle}>
            <View style={locationFieldStyle}>
              <Text style={styles.modalLabelSmall}>Location</Text>
              <TextInput
                style={styles.input}
                testID="flight-modal-layover-location"
                value={getLocationInputValue(flight.layoverLocation, 'modal-layover', activeAirportTarget ?? null)}
                placeholder="Layover location"
                ref={modalLayoverLocationRef}
                onFocus={() => showAirportDropdown('modal-layover', modalLayoverLocationRef.current, flight.layoverLocation)}
                onChangeText={(text: string) => {
                  setFlight((prev) => (prev ? { ...prev, layoverLocation: text } : prev));
                  showAirportDropdown('modal-layover', modalLayoverLocationRef.current, text);
                }}
                onKeyPress={(e: any) => {
                  if (e?.nativeEvent?.key === 'Enter' || e?.nativeEvent?.key === 'Tab') {
                    onAirportEnter('modal-layover', flight.layoverLocation);
                  }
                }}
                onBlur={() => {
                  onAirportEnter('modal-layover', flight.layoverLocation);
                }}
              />
            </View>
            <View style={timeFieldStyle}>
              <Text style={styles.modalLabelSmall}>Duration</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(() => {
                  const { hours, minutes } = parseLayoverDuration(flight.layoverDuration);
                  return (
                    <>
                      <TextInput
                        style={[styles.input, { flex: 1, minWidth: 90, maxWidth: 140 }]}
                        keyboardType="numeric"
                        placeholder="Hours"
                        value={hours}
                        onChangeText={(text: string) => {
                          const { minutes: currentMinutes } = parseLayoverDuration(flight.layoverDuration);
                          setFlight((prev) => (prev ? { ...prev, layoverDuration: `${text}h ${currentMinutes || '0'}m` } : prev));
                        }}
                      />
                      <TextInput
                        style={[styles.input, { flex: 1, minWidth: 90, maxWidth: 140 }]}
                        keyboardType="numeric"
                        placeholder="Minutes"
                        value={minutes}
                        onChangeText={(text: string) => {
                          const { hours: currentHours } = parseLayoverDuration(flight.layoverDuration);
                          setFlight((prev) => (prev ? { ...prev, layoverDuration: `${currentHours || '0'}h ${text}m` } : prev));
                        }}
                      />
                    </>
                  );
                })()}
              </View>
            </View>
          </View>
          <Text style={[styles.modalLabel, { marginTop: 16 }]}>Transfer</Text>
          <View style={rowStyle}>
            <View style={locationFieldStyle}>
              <Text style={styles.modalLabelSmall}>Carrier</Text>
              <TextInput
                style={styles.input}
                testID="flight-modal-carrier"
                value={flight.carrier}
                onChangeText={(text: string) => setFlight((prev) => (prev ? { ...prev, carrier: text } : prev))}
              />
            </View>
            <View style={locationFieldStyle}>
              <Text style={styles.modalLabelSmall}>Transfer #</Text>
              <TextInput
                style={styles.input}
                testID="flight-modal-flight-number"
                value={flight.flightNumber}
                onChangeText={(text: string) => setFlight((prev) => (prev ? { ...prev, flightNumber: text } : prev))}
              />
            </View>
            <View style={locationFieldStyle}>
              <Text style={styles.modalLabelSmall}>Booking Ref</Text>
              <TextInput
                style={styles.input}
                testID="flight-modal-booking-reference"
                value={flight.bookingReference}
                onChangeText={(text: string) => setFlight((prev) => (prev ? { ...prev, bookingReference: text.toUpperCase() } : prev))}
              />
            </View>
          </View>
          <Text style={[styles.modalLabel, { marginTop: 16 }]}>Cost</Text>
          <TextInput
            style={styles.input}
            testID="flight-modal-cost"
            value={flight.cost}
            keyboardType="numeric"
            onChangeText={(text: string) =>
              setFlight((prev) => (prev ? { ...prev, cost: sanitizeCostInput(text) } : prev))
            }
          />
          <Text style={[styles.modalLabel, { marginTop: 16 }]}>Paid by</Text>
          <View style={styles.payerChips}>
            {groupMembers.map((m) => {
              const selected = flight.paidBy.includes(m.id);
              const name = formatMemberName(m);
              return (
                <TouchableOpacity
                  key={`payer-${m.id}`}
                  style={[toggleBaseStyle, selected && toggleSelectedStyle]}
                  onPress={() =>
                    setFlight((prev) => {
                      if (!prev) return prev;
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
        </KeyboardAvoidingView>
        <View style={[styles.row, { marginTop: 16 }]}>
          <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={onClose}>
            <Text style={styles.dangerButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={onSave} testID="flight-modal-save">
            <Text style={styles.buttonText}>Save</Text>
          </TouchableOpacity>
        </View>
        </View>
      </View>
      {activeAirportTarget && activeAirportTarget.startsWith('modal-') && airportAnchor ? (
        <View style={[styles.passengerOverlay, { backgroundColor: 'transparent', zIndex: 56000, elevation: 90 }]}>
          <TouchableOpacity
            style={[styles.passengerOverlayBackdrop, { backgroundColor: 'transparent' }]}
            onPress={onHideAirportDropdown}
          />
          <View
            style={[
              styles.passengerOverlayList,
              {
                zIndex: 57000,
                elevation: 94,
                left: airportAnchor.x,
                top: airportAnchor.y + airportAnchor.height,
                width: airportAnchor.width || 280,
              },
            ]}
          >
            {airportSuggestions.map((airport) => (
              <TouchableOpacity
                key={`${airport.iata_code ?? 'na'}-${airport.name}`}
                style={styles.dropdownOption}
                onPressIn={onAirportOptionPressIn}
                onPress={() => {
                  if (onSelectAirport) onSelectAirport(activeAirportTarget, airport);
                }}
              >
                <Text style={styles.cellText}>
                  {formatAirportLabel ? formatAirportLabel(airport) : airport.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}
      {Platform.OS !== 'web' && timePickerValue && NativeDateTimePicker ? (
        <NativeDatePickerSheet
          visible={!!timePickerTarget}
          onRequestClose={() => onTimePickerChange?.({ type: 'dismissed' }, undefined, timePickerTarget ?? null)}
          theme={theme}
          testID="flight-edit-time-picker"
        >
          <NativeDateTimePicker
            value={timePickerValue}
            mode="time"
            onChange={(event: { type?: string } | undefined, date: Date | undefined) => onTimePickerChange?.(event, date, timePickerTarget ?? null)}
          />
        </NativeDatePickerSheet>
      ) : null}
    </Modal>
  );
};

