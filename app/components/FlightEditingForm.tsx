import React from 'react';
import { Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { formatDateLong } from '../utils/formatDateLong';
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
  setFlight: React.Dispatch<React.SetStateAction<FlightEditDraft | null>>;
  setPassengerIds: (ids: string[]) => void;
  modalDepLocationRef: React.RefObject<TextInput>;
  modalArrLocationRef: React.RefObject<TextInput>;
  modalLayoverLocationRef: React.RefObject<TextInput>;
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
  setFlight,
  setPassengerIds,
  modalDepLocationRef,
  modalArrLocationRef,
  modalLayoverLocationRef,
  onClose,
  onSave,
}) => {
  if (!visible || !flight || !flightId) return null;

  return (
    <View style={[styles.passengerOverlay, overlayStyle]}>
      <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={onClose} />
      <View style={[styles.modalCard, cardStyle]}>
        <Text style={styles.sectionTitle}>Flight Details</Text>
        <Text style={styles.helperText}>
          Current Departure: {formatDateLong(flight.departureDate)} at {flight.departureTime || '?'}
        </Text>
        <ScrollView style={{ maxHeight: 420 }}>
          <Text style={styles.modalLabel}>Passengers (tap to toggle)</Text>
          <View style={styles.payerChips}>
            {groupMembers.map((m) => {
              const selected = flight.passengerIds.includes(m.id);
              const name = formatMemberName(m);
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.payerChip, selected && styles.toggleActive]}
                  onPress={() => {
                    const next = selected ? flight.passengerIds.filter((id) => id !== m.id) : [...flight.passengerIds, m.id];
                    setPassengerIds(next);
                  }}
                >
                  <Text style={styles.cellText}>{name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.modalLabel}>Departure</Text>
          <View style={styles.modalRow}>
            <View style={styles.modalField}>
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
            <View style={styles.modalField}>
              <Text style={styles.modalLabelSmall}>Location</Text>
              <View style={{ position: 'relative' }}>
                <TextInput
                  style={styles.input}
                  value={getLocationInputValue(flight.departureLocation, 'modal-dep', airportTarget)}
                  placeholder="Location"
                  ref={modalDepLocationRef}
                  onFocus={() => showAirportDropdown('modal-dep', modalDepLocationRef.current, flight.departureLocation)}
                  onChangeText={(text: string) => {
                    setFlight((prev) => (prev ? { ...prev, departureLocation: text } : prev));
                    showAirportDropdown('modal-dep', modalDepLocationRef.current, text);
                  }}
                />
                <TouchableOpacity
                  style={{ position: 'absolute', right: 8, top: 10, padding: 6 }}
                  onPress={() => showAirportDropdown('modal-dep', modalDepLocationRef.current, flight.departureLocation)}
                >
                  <Text style={styles.selectCaret}>ƒ-¬</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.modalField}>
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
          <View style={styles.modalRow}>
            <View style={styles.modalField}>
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
            <View style={styles.modalField}>
              <Text style={styles.modalLabelSmall}>Location</Text>
              <View style={{ position: 'relative' }}>
                <TextInput
                  style={styles.input}
                  value={getLocationInputValue(flight.arrivalLocation, 'modal-arr', airportTarget)}
                  placeholder="Location"
                  ref={modalArrLocationRef}
                  onFocus={() => showAirportDropdown('modal-arr', modalArrLocationRef.current, flight.arrivalLocation)}
                  onChangeText={(text: string) => {
                    setFlight((prev) => (prev ? { ...prev, arrivalLocation: text } : prev));
                    showAirportDropdown('modal-arr', modalArrLocationRef.current, text);
                  }}
                />
                <TouchableOpacity
                  style={{ position: 'absolute', right: 8, top: 10, padding: 6 }}
                  onPress={() => showAirportDropdown('modal-arr', modalArrLocationRef.current, flight.arrivalLocation)}
                >
                  <Text style={styles.selectCaret}>ƒ-¬</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.modalField}>
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
          <View style={styles.modalRow}>
            <View style={styles.modalField}>
              <Text style={styles.modalLabelSmall}>Location</Text>
              <View style={{ position: 'relative' }}>
                <TextInput
                  style={styles.input}
                  value={getLocationInputValue(flight.layoverLocation, 'modal-layover', airportTarget)}
                  placeholder="Layover location"
                  ref={modalLayoverLocationRef}
                  onFocus={() => showAirportDropdown('modal-layover', modalLayoverLocationRef.current, flight.layoverLocation)}
                  onChangeText={(text: string) => {
                    setFlight((prev) => (prev ? { ...prev, layoverLocation: text } : prev));
                    showAirportDropdown('modal-layover', modalLayoverLocationRef.current, text);
                  }}
                />
                <TouchableOpacity
                  style={{ position: 'absolute', right: 8, top: 10, padding: 6 }}
                  onPress={() => showAirportDropdown('modal-layover', modalLayoverLocationRef.current, flight.layoverLocation)}
                >
                  <Text style={styles.selectCaret}>ƒ-¬</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.modalField}>
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
          <View style={styles.modalRow}>
            <View style={styles.modalField}>
              <Text style={styles.modalLabelSmall}>Carrier</Text>
              <TextInput
                style={styles.input}
                value={flight.carrier}
                onChangeText={(text: string) => setFlight((prev) => (prev ? { ...prev, carrier: text } : prev))}
              />
            </View>
            <View style={styles.modalField}>
              <Text style={styles.modalLabelSmall}>Flight #</Text>
              <TextInput
                style={styles.input}
                value={flight.flightNumber}
                onChangeText={(text: string) => setFlight((prev) => (prev ? { ...prev, flightNumber: text } : prev))}
              />
            </View>
            <View style={styles.modalField}>
              <Text style={styles.modalLabelSmall}>Booking Ref</Text>
              <TextInput
                style={styles.input}
                value={flight.bookingReference}
                onChangeText={(text: string) => setFlight((prev) => (prev ? { ...prev, bookingReference: text.toUpperCase() } : prev))}
              />
            </View>
          </View>
          <Text style={styles.modalLabel}>Cost</Text>
          <TextInput
            style={styles.input}
            value={flight.cost}
            keyboardType="numeric"
            onChangeText={(text: string) => setFlight((prev) => (prev ? { ...prev, cost: text } : prev))}
          />
          <Text style={styles.modalLabel}>Paid by</Text>
          <View style={[styles.input, styles.payerBox]}>
            <View style={styles.payerChips}>
              {flight.paidBy.map((id) => (
                <View key={id} style={styles.payerChip}>
                  <Text style={styles.cellText}>{payerName(id)}</Text>
                  <TouchableOpacity
                    onPress={() =>
                      setFlight((p) =>
                        p
                          ? {
                              ...p,
                              paidBy: p.paidBy.filter((x) => x !== id),
                            }
                          : p
                      )
                    }
                  >
                    <Text style={styles.removeText}>x</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
            <View style={styles.payerOptions}>
              {userMembers
                .filter((m) => !flight.paidBy.includes(m.id))
                .map((m) => (
                  <TouchableOpacity key={m.id} style={styles.smallButton} onPress={() => setFlight((p) => (p ? { ...p, paidBy: [...p.paidBy, m.id] } : p))}>
                    <Text style={styles.buttonText}>Add {formatMemberName(m)}</Text>
                  </TouchableOpacity>
                ))}
            </View>
          </View>
        </ScrollView>
        <View style={styles.row}>
          <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={onClose}>
            <Text style={styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={onSave}>
            <Text style={styles.buttonText}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};
