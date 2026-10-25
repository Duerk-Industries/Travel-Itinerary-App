import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import PayerSelect from './PayerSelect';
import KeyboardViewport from './KeyboardViewport';
import AirportInput from './AirportInput';
import { TRANSFER_TYPES as CANONICAL_TRANSFER_TYPES, normalizeTransferType } from '../utils/transferTypes';
import TransferDirections from './TransferDirections';
import type { MapApp } from '../utils/mapLinks';
import HotelAddressPicker from './HotelAddressPicker';
import { transferLocationFieldLabel, type TransferActivity, type TransferHotel } from '../utils/transferHotels';
import React from 'react';
import {  Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Modal from './KeyboardAwareModal';
import { formatDateLong } from '../utils/formatDateLong';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import type { FlightEditDraft, GroupMemberOption, TransferType } from '../tabs/transfers';
import { toWebStyle } from '../utils/webStyle';
import { DEFAULT_NEW_ITINERARY_STATUS, ITINERARY_STATUSES, normalizeItineraryStatus } from '../utils/itineraryStatus';

import DateField from './DateField';

type AirportTarget = 'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover' | null;
const TRANSFER_TYPES: TransferType[] = [...CANONICAL_TRANSFER_TYPES];

export type FlightEditingFormProps = {
  modalKind?: 'flight' | 'ground';
  backendUrl?: string;
  headers?: Record<string, string>;
  mapApp?: MapApp;
  lodgings?: TransferHotel[];
  activities?: TransferActivity[];
  transferTypes?: TransferType[];
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
  onAirportEnter: (target: Exclude<AirportTarget, null>, value: string) => void;
  setFlight: React.Dispatch<React.SetStateAction<FlightEditDraft | null>>;
  setPassengerIds: (ids: string[]) => void;
  modalDepLocationRef: React.RefObject<React.ElementRef<typeof TextInput> | null>;
  modalArrLocationRef: React.RefObject<React.ElementRef<typeof TextInput> | null>;
  modalLayoverLocationRef: React.RefObject<React.ElementRef<typeof TextInput> | null>;
  onClose: () => void;
  onSave: () => void;
};

const TransferEditingForm: React.FC<FlightEditingFormProps> = ({
  modalKind,
  transferTypes = TRANSFER_TYPES,
  lodgings = [],
  activities = [],
  mapApp,
  backendUrl,
  headers,
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
  theme: _providedTheme,
  formatMemberName,
  payerName,
  airportTarget: activeAirportTarget,
  getLocationInputValue,
  showAirportDropdown,
  parseLayoverDuration,
  onAirportEnter,
  setFlight,
  setPassengerIds,
  modalDepLocationRef,
  modalArrLocationRef,
  modalLayoverLocationRef,
  onClose,
  onSave,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  if (!visible || !flight || !flightId) return null;

  const ground = modalKind ? modalKind === 'ground' : flight.transferType !== 'Flight';

  const toggleBaseStyle = styles.toggleOption ?? themeStyle('components_TransferEditingForm_1', { theme: theme }, (theme ?? _styleTheme));
  const toggleSelectedStyle = styles.toggleOptionSelected ?? themeStyle('components_TransferEditingForm_2', { theme: theme }, (theme ?? _styleTheme));
  const toggleTextStyle = styles.toggleOptionText ?? themeStyle('components_TransferEditingForm_3', { theme: theme }, (theme ?? _styleTheme));
  const toggleTextSelectedStyle = styles.toggleOptionTextSelected ?? themeStyle('components_TransferEditingForm_4', { theme: theme }, (theme ?? _styleTheme));
  const rowStyle = [styles.modalRow, themeStyle('components_TransferEditingForm_5', {  }, (theme ?? _styleTheme))];
  const fieldStyle = [styles.modalField, themeStyle('components_TransferEditingForm_6', {  }, (theme ?? _styleTheme))];
  const dateFieldStyle = [styles.modalField, themeStyle('components_TransferEditingForm_7', {  }, (theme ?? _styleTheme))];
  const timeFieldStyle = [styles.modalField, themeStyle('components_TransferEditingForm_8', {  }, (theme ?? _styleTheme))];
  const locationFieldStyle = [styles.modalField, themeStyle('components_TransferEditingForm_9', {  }, (theme ?? _styleTheme))];

  const baseOverlayStyle = themeStyle('components_TransferEditingForm_10', {  }, (theme ?? _styleTheme));
  const baseCardStyle = themeStyle('components_TransferEditingForm_11', {  }, (theme ?? _styleTheme));

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={[styles.passengerOverlay, baseOverlayStyle, overlayStyle]}>
        <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={onClose} />
        <View style={[styles.modalCard, baseCardStyle, cardStyle]}>
        <Text style={styles.sectionTitle}>{ground ? 'Ground Transfer Details' : 'Flight Details'}</Text>
        <Text style={styles.helperText}>
          Current Departure: {formatDateLong(flight.departureDate)} at {flight.departureTime || '?'}
        </Text>
        <KeyboardViewport
          style={themeStyle('components_TransferEditingForm_12', {  }, (theme ?? _styleTheme))}
        >
        <ScrollView
          style={themeStyle('components_TransferEditingForm_13', {  }, (theme ?? _styleTheme))}
          contentContainerStyle={themeStyle('components_TransferEditingForm_14', {  }, (theme ?? _styleTheme))}
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
          <Text style={[styles.modalLabel, themeStyle('components_TransferEditingForm_15', {  }, (theme ?? _styleTheme))]}>Status</Text>
          {Platform.OS === 'web' ? (
            <select
              value={normalizeItineraryStatus(flight.status, DEFAULT_NEW_ITINERARY_STATUS)}
              onChange={(e) => setFlight((prev) => (prev ? { ...prev, status: normalizeItineraryStatus(e.target.value, DEFAULT_NEW_ITINERARY_STATUS) } : prev))}
              style={toWebStyle(styles.input, themeStyle('components_TransferEditingForm_16', {  }, (theme ?? _styleTheme)))}
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
          {ground && <>
          <Text style={[styles.modalLabel, themeStyle('components_TransferEditingForm_17', {  }, (theme ?? _styleTheme))]}>Type</Text>
          {Platform.OS === 'web' ? (
            <select
              value={normalizeTransferType(flight.transferType)}
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
              style={toWebStyle(styles.input, themeStyle('components_TransferEditingForm_18', {  }, (theme ?? _styleTheme)))}
            >
              {transferTypes.map((opt) => (
                <option key={`transfer-type-${opt}`} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <View style={styles.payerChips}>
              {transferTypes.map((opt) => {
                const selected = normalizeTransferType(flight.transferType) === opt;
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
          </>}
          <Text style={[styles.modalLabel, themeStyle('components_TransferEditingForm_19', {  }, (theme ?? _styleTheme))]}>Departure</Text>
          <View style={rowStyle}>
            <View style={dateFieldStyle}>
              <Text style={styles.modalLabelSmall}>Date</Text>
              <DateField
                value={flight.departureDate}
                onChange={(dep) =>
                  setFlight((prev) => {
                    if (!prev) return prev;
                    const nextArrival = ground || !prev.arrivalDate || prev.arrivalDate === prev.departureDate
                      ? dep
                      : prev.arrivalDate;
                    return { ...prev, departureDate: dep, arrivalDate: nextArrival };
                  })
                }
                styles={styles}
                theme={theme}
                testID="transfer-departure-date"
                accessibilityLabel="Departure date"
              />
            </View>
            <View style={timeFieldStyle}>
              <Text style={styles.modalLabelSmall}>Time</Text>
              <DateField
                mode="time"
                value={flight.departureTime}
                onChange={(departureTime) => setFlight((prev) => (prev ? { ...prev, departureTime } : prev))}
                styles={styles}
                theme={theme}
                testID="transfer-departure-time"
                accessibilityLabel="Departure time"
              />
            </View>
          </View>
          <View style={rowStyle}>
            <View style={locationFieldStyle}>
              <Text style={styles.modalLabelSmall}>Location</Text>
              {ground ? <View style={themeStyle('components_TransferEditingForm_20', {  }, (theme ?? _styleTheme))}>
                <HotelAddressPicker hotels={lodgings} activities={activities} date={flight.departureDate} styles={styles} testID="ground-departure-hotel"
                  onSelect={address => setFlight(prev => prev ? { ...prev, departureLocation: address } : prev)} />
                <TextInput style={[styles.input, themeStyle('components_TransferEditingForm_21', {  }, (theme ?? _styleTheme))]} testID="flight-modal-departure-location"
                  value={transferLocationFieldLabel(flight.departureLocation, lodgings, flight.departureDate, activities)} placeholder="Location" autoComplete="off"
                  onChangeText={(text: string) => setFlight(prev => prev ? { ...prev, departureLocation: text } : prev)} />
              </View> : backendUrl ? (
                <AirportInput backendUrl={backendUrl} headers={headers} styles={styles}
                  testID="flight-modal-departure-location" value={flight.departureLocation}
                  onChange={(location, code) => setFlight(prev => prev ? { ...prev, departureLocation: location, departureAirportCode: code } : prev)} />
              ) : (
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
              )}
            </View>
          </View>
          <Text style={[styles.modalLabel, themeStyle('components_TransferEditingForm_22', {  }, (theme ?? _styleTheme))]}>Arrival</Text>
          <View style={rowStyle}>
            <View style={dateFieldStyle}>
              <Text style={styles.modalLabelSmall}>Date</Text>
              <DateField
                value={flight.arrivalDate}
                onChange={(arrivalDate) => setFlight((prev) => (prev ? { ...prev, arrivalDate } : prev))}
                styles={styles}
                theme={theme}
                testID="transfer-arrival-date"
                accessibilityLabel="Arrival date"
              />
            </View>
            <View style={timeFieldStyle}>
              <Text style={styles.modalLabelSmall}>Time</Text>
              <DateField
                mode="time"
                value={flight.arrivalTime}
                onChange={(arrivalTime) => setFlight((prev) => (prev ? { ...prev, arrivalTime } : prev))}
                styles={styles}
                theme={theme}
                testID="transfer-arrival-time"
                accessibilityLabel="Arrival time"
              />
            </View>
          </View>
          <View style={rowStyle}>
            <View style={locationFieldStyle}>
              <Text style={styles.modalLabelSmall}>Location</Text>
              {ground ? <View style={themeStyle('components_TransferEditingForm_23', {  }, (theme ?? _styleTheme))}>
                <HotelAddressPicker hotels={lodgings} activities={activities} date={flight.arrivalDate || flight.departureDate} styles={styles} testID="ground-arrival-hotel"
                  onSelect={address => setFlight(prev => prev ? { ...prev, arrivalLocation: address } : prev)} />
                <TextInput style={[styles.input, themeStyle('components_TransferEditingForm_24', {  }, (theme ?? _styleTheme))]} testID="flight-modal-arrival-location"
                  value={transferLocationFieldLabel(flight.arrivalLocation, lodgings, flight.arrivalDate || flight.departureDate, activities)} placeholder="Location" autoComplete="off"
                  onChangeText={(text: string) => setFlight(prev => prev ? { ...prev, arrivalLocation: text } : prev)} />
              </View> : backendUrl ? (
                <AirportInput backendUrl={backendUrl} headers={headers} styles={styles}
                  testID="flight-modal-arrival-location" value={flight.arrivalLocation}
                  onChange={(location, code) => setFlight(prev => prev ? { ...prev, arrivalLocation: location, arrivalAirportCode: code } : prev)} />
              ) : (
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
              )}
            </View>
          </View>

          {ground && <TransferDirections lodgings={lodgings} departureDate={flight.departureDate} arrivalDate={flight.arrivalDate} origin={flight.departureLocation} destination={flight.arrivalLocation} transferType={flight.transferType} mapApp={mapApp} styles={styles} />}
          {!ground && <>
          <Text style={[styles.modalLabel, themeStyle('components_TransferEditingForm_25', {  }, (theme ?? _styleTheme))]}>Layover</Text>
          <View style={rowStyle}>
            <View style={locationFieldStyle}>
              <Text style={styles.modalLabelSmall}>Location</Text>
              {backendUrl ? <AirportInput backendUrl={backendUrl} headers={headers} styles={styles}
                testID="flight-modal-layover-location" value={flight.layoverLocation}
                onChange={(location, code) => setFlight(prev => prev ? { ...prev, layoverLocation: location, layoverLocationCode: code } : prev)} /> : (
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
              )}
            </View>
            <View style={timeFieldStyle}>
              <Text style={styles.modalLabelSmall}>Duration</Text>
              <View style={themeStyle('components_TransferEditingForm_26', {  }, (theme ?? _styleTheme))}>
                {(() => {
                  const { hours, minutes } = parseLayoverDuration(flight.layoverDuration);
                  return (
                    <>
                      <TextInput
                        style={[styles.input, themeStyle('components_TransferEditingForm_27', {  }, (theme ?? _styleTheme))]}
                        keyboardType="numeric"
                        placeholder="Hours"
                        value={hours}
                        onChangeText={(text: string) => {
                          const { minutes: currentMinutes } = parseLayoverDuration(flight.layoverDuration);
                          setFlight((prev) => (prev ? { ...prev, layoverDuration: `${text}h ${currentMinutes || '0'}m` } : prev));
                        }}
                      />
                      <TextInput
                        style={[styles.input, themeStyle('components_TransferEditingForm_28', {  }, (theme ?? _styleTheme))]}
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
          </>}
          <Text style={[styles.modalLabel, themeStyle('components_TransferEditingForm_29', {  }, (theme ?? _styleTheme))]}>{ground ? 'Transfer' : 'Flight'}</Text>
          <View style={rowStyle}>
            <View style={locationFieldStyle}>
              <Text style={styles.modalLabelSmall}>{ground ? 'Provider' : 'Airline'}</Text>
              <TextInput
                style={styles.input}
                testID="flight-modal-carrier"
                value={flight.carrier}
                onChangeText={(text: string) => setFlight((prev) => (prev ? { ...prev, carrier: text } : prev))}
              />
            </View>
            {!ground && (
            <View style={locationFieldStyle}>
              <Text style={styles.modalLabelSmall}>Flight Number</Text>
              <TextInput
                style={styles.input}
                testID="flight-modal-flight-number"
                value={flight.flightNumber}
                onChangeText={(text: string) => setFlight((prev) => (prev ? { ...prev, flightNumber: text } : prev))}
              />
            </View>
            )}
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
          <Text style={[styles.modalLabel, themeStyle('components_TransferEditingForm_30', {  }, (theme ?? _styleTheme))]}>Cost</Text>
          <TextInput
            style={styles.input}
            testID="flight-modal-cost"
            value={flight.cost}
            keyboardType="numeric"
            onChangeText={(text: string) =>
              setFlight((prev) => (prev ? { ...prev, cost: sanitizeCostInput(text) } : prev))
            }
          />
          <Text style={[styles.modalLabel, themeStyle('components_TransferEditingForm_31', {  }, (theme ?? _styleTheme))]}>Paid by</Text>
          <PayerSelect members={groupMembers} value={flight.paidBy} formatName={formatMemberName} onChange={ids => setFlight((prev) => prev ? ({ ...prev, paidBy: ids }) : prev)} styles={styles} testID="transfer-payer" />
        </ScrollView>
        </KeyboardViewport>
        <View style={[styles.row, themeStyle('components_TransferEditingForm_32', {  }, (theme ?? _styleTheme))]}>
          <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={onClose}>
            <Text style={styles.dangerButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={onSave} testID="flight-modal-save">
            <Text style={styles.buttonText}>Save</Text>
          </TouchableOpacity>
        </View>
        </View>
      </View>
      {!ground && activeAirportTarget && activeAirportTarget.startsWith('modal-') && airportAnchor ? (
        <View style={[styles.passengerOverlay, themeStyle('components_TransferEditingForm_33', {  }, (theme ?? _styleTheme))]}>
          <TouchableOpacity
            style={[styles.passengerOverlayBackdrop, themeStyle('components_TransferEditingForm_34', {  }, (theme ?? _styleTheme))]}
            onPress={onHideAirportDropdown}
          />
          <View
            style={[
              styles.passengerOverlayList,
              themeStyle('components_TransferEditingForm_35', { airportAnchor: airportAnchor }, (theme ?? _styleTheme)),
            ]}
          >
            {airportSuggestions.map((airport) => (
              <TouchableOpacity
                key={`${airport.iata_code ?? 'na'}-${airport.name}`}
                style={styles.dropdownOption}
                onPressIn={onAirportOptionPressIn}
                // See DropdownOptionButton: without this the press-in arrives 50 ms after the input's blur.
                delayPressIn={0}
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
    </Modal>
  );
};


// Distinct modal components keep flight and ground editing lifecycles separate.
export const FlightEditingForm: React.FC<FlightEditingFormProps> = props => <TransferEditingForm {...props} modalKind="flight" />;
export const GroundTransferEditingForm: React.FC<FlightEditingFormProps> = props => <TransferEditingForm {...props} modalKind="ground" transferTypes={TRANSFER_TYPES.filter(type => type !== 'Flight')} />;
