import React from 'react';
import { Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { formatDateLong } from '../utils/formatDateLong';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import type { FlightEditDraft, GroupMemberOption } from '../tabs/flights';

type AirportTarget = 'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover' | null;

export type FlightEditingFormProps = {
  visible: boolean;
  flightId: string | null;
  flight: FlightEditDraft | null;
  overlayStyle?: Record<string, any>;
  cardStyle?: Record<string, any>;
  groupMembers: GroupMemberOption[];
  userMembers: GroupMemberOption[];
  styles: Record<string, any>;
  formatMemberName: (member: GroupMemberOption) => string;
  payerName: (id: string) => string;
  airportTarget: AirportTarget;
  getLocationInputValue: (raw: string, activeTarget: AirportTarget, currentTarget: AirportTarget) => string;
  showAirportDropdown: (target: Exclude<AirportTarget, null>, node: any, query: string) => void;
  parseLayoverDuration: (value: string | null | undefined) => { hours: string; minutes: string };
  openTimePicker: (target: 'edit-dep' | 'edit-arr' | 'new-dep' | 'new-arr', current: string) => void;
  onAirportEnter: (target: Exclude<AirportTarget, null>, value: string) => void;
  setFlight: React.Dispatch<React.SetStateAction<FlightEditDraft | null>>;
  setPassengerIds: (ids: string[]) => void;
  modalDepLocationRef: React.RefObject<React.ElementRef<typeof TextInput>>;
  modalArrLocationRef: React.RefObject<React.ElementRef<typeof TextInput>>;
  modalLayoverLocationRef: React.RefObject<React.ElementRef<typeof TextInput>>;
  onClose: () => void;
  onSave: () => void;
};

export const FlightEditingForm: React.FC<FlightEditingFormProps> = ({
  visible,
  flightId,
  flight,
  overlayStyle,
  cardStyle,
  groupMembers,
  userMembers,
  styles,
  formatMemberName,
  payerName,
  airportTarget,
  getLocationInputValue,
  showAirportDropdown,
  parseLayoverDuration,
  openTimePicker,
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

  const resolveTravelerLabel = (member: GroupMemberOption) => {
    const first = member.firstName?.trim() ?? '';
    const last = member.lastName?.trim() ?? '';
    if (first || last) return `${first} ${last}`.trim();
    const guest = member.guestName?.trim() ?? '';
    if (guest) return guest;
    const email = (member.email ?? (member as any).userEmail ?? '').trim();
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
  const rowStyle = [styles.modalRow, { flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }];
  const fieldStyle = [styles.modalField, { minWidth: 180, flex: 1 }];
  const dateFieldStyle = [styles.modalField, { flexGrow: 0, flexShrink: 0, flexBasis: 170, minWidth: 170, maxWidth: 200 }];
  const timeFieldStyle = [styles.modalField, { flexGrow: 0, flexShrink: 0, flexBasis: 100, minWidth: 100 }];
  const locationFieldStyle = [styles.modalField, { minWidth: 220, flexGrow: 1, flexBasis: 0 }];

  return (
    <View style={[styles.passengerOverlay, overlayStyle]}>
      <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={onClose} />
      <View style={[styles.modalCard, cardStyle]}>
        <Text style={styles.sectionTitle}>Flight Details</Text>
        <Text style={styles.helperText}>
          Current Departure: {formatDateLong(flight.departureDate)} at {flight.departureTime || '?'}
        </Text>
        <ScrollView style={{ maxHeight: 420 }}>
          <Text style={styles.modalLabel}>Passengers</Text>
          <View style={styles.payerChips}>
            {groupMembers.map((m) => {
              const selected = flight.passengerIds.includes(m.id);
              const name = resolveTravelerLabel(m);
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
          <Text style={styles.modalLabel}>Departure</Text>
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
                  style={styles.input as any}
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
            <View style={locationFieldStyle}>
              <Text style={styles.modalLabelSmall}>Location</Text>
              <TextInput
                style={styles.input}
                testID="flight-modal-departure-location"
                value={getLocationInputValue(flight.departureLocation, 'modal-dep', airportTarget)}
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
            <View style={timeFieldStyle}>
              <Text style={styles.modalLabelSmall}>Time</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="time"
                  value={flight.departureTime}
                  onChange={(e) => setFlight((prev) => (prev ? { ...prev, departureTime: e.target.value } : prev))}
                  style={styles.input as any}
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
          <Text style={styles.modalLabel}>Arrival</Text>
          <View style={rowStyle}>
            <View style={dateFieldStyle}>
              <Text style={styles.modalLabelSmall}>Date</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={flight.arrivalDate}
                  onChange={(e) => setFlight((prev) => (prev ? { ...prev, arrivalDate: e.target.value } : prev))}
                  style={styles.input as any}
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
            <View style={locationFieldStyle}>
              <Text style={styles.modalLabelSmall}>Location</Text>
              <TextInput
                style={styles.input}
                testID="flight-modal-arrival-location"
                value={getLocationInputValue(flight.arrivalLocation, 'modal-arr', airportTarget)}
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
            <View style={timeFieldStyle}>
              <Text style={styles.modalLabelSmall}>Time</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="time"
                  value={flight.arrivalTime}
                  onChange={(e) => setFlight((prev) => (prev ? { ...prev, arrivalTime: e.target.value } : prev))}
                  style={styles.input as any}
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

          <Text style={styles.modalLabel}>Layover</Text>
          <View style={rowStyle}>
            <View style={locationFieldStyle}>
              <Text style={styles.modalLabelSmall}>Location</Text>
              <TextInput
                style={styles.input}
                testID="flight-modal-layover-location"
                value={getLocationInputValue(flight.layoverLocation, 'modal-layover', airportTarget)}
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
                        style={[styles.input, { flex: 1 }]}
                        keyboardType="numeric"
                        placeholder="Hours"
                        value={hours}
                        onChangeText={(text: string) => {
                          const { minutes: currentMinutes } = parseLayoverDuration(flight.layoverDuration);
                          setFlight((prev) => (prev ? { ...prev, layoverDuration: `${text}h ${currentMinutes || '0'}m` } : prev));
                        }}
                      />
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
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
          <Text style={styles.modalLabel}>Flight</Text>
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
              <Text style={styles.modalLabelSmall}>Flight #</Text>
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
          <Text style={styles.modalLabel}>Cost</Text>
          <TextInput
            style={styles.input}
            testID="flight-modal-cost"
            value={flight.cost}
            keyboardType="numeric"
            onChangeText={(text: string) =>
              setFlight((prev) => (prev ? { ...prev, cost: sanitizeCostInput(text) } : prev))
            }
          />
          <Text style={styles.modalLabel}>Paid by</Text>
          <View style={styles.payerChips}>
            {groupMembers.map((m) => {
              const selected = flight.paidBy.includes(m.id);
              const name = resolveTravelerLabel(m);
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
        <View style={styles.row}>
          <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={onClose}>
            <Text style={styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={onSave} testID="flight-modal-save">
            <Text style={styles.buttonText}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};
