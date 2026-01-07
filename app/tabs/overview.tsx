import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { computeTripDays, validateTripDates } from '../utils/createTripWizard';
import { formatDateLong } from '../utils/formatDateLong';
import { renderRichTextBlocks } from '../utils/richText';
import {
  buildOverviewRows,
  formatFlightDetails,
  formatLodgingDetails,
  formatTourDetails,
  type OverviewRow,
} from '../utils/overviewBuilder';
import {
  adjustStartDateForEarliest,
  formatMonthYear,
  getEarliestTripEventDate,
} from '../utils/tripDates';
import { normalizeDateString } from '../utils/normalizeDateString';
import {
  createInitialFlightCreateDraft,
  createFlightForTrip,
  type FlightCreateDraft,
} from '../tabs/flights';
import {
  createInitialLodgingState,
  createLodgingForTrip,
  type LodgingDraft,
} from '../tabs/lodging';
import {
  createInitialTourState,
  createTourForTrip,
  type TourDraft,
} from '../tabs/tours';
import {
  buildCarRentalFromDraft,
  createInitialCarRentalDraft,
  type CarRental,
  type CarRentalDraft,
} from '../tabs/carRentals';

type NativeDateTimePickerType = typeof import('@react-native-community/datetimepicker').default;
let NativeDateTimePicker: NativeDateTimePickerType | null = null;
if (Platform.OS !== 'web') {
  try {
    const mod = require('@react-native-community/datetimepicker');
    NativeDateTimePicker = (mod?.default ?? mod) as NativeDateTimePickerType;
  } catch (err) {
    console.warn('DateTimePicker unavailable, falling back to text inputs');
    NativeDateTimePicker = null;
  }
}

type Trip = {
  id: string;
  groupId: string;
  name: string;
  description?: string | null;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  startMonth?: number | null;
  startYear?: number | null;
  durationDays?: number | null;
  createdAt: string;
};

type GroupView = {
  id: string;
  name: string;
  members: Array<{ id: string; userEmail?: string; email?: string; guestName?: string }>;
};

type Flight = {
  id: string;
  departure_date: string;
  departure_time: string;
  arrival_time: string;
  departure_airport_code?: string;
  arrival_airport_code?: string;
  carrier: string;
  flight_number: string;
  booking_reference: string;
  layover_location?: string;
  layover_location_code?: string;
  layover_duration?: string;
  cost: number;
};

type Lodging = {
  id: string;
  name: string;
  checkInDate: string;
  checkOutDate: string;
  rooms: string;
  refundBy: string;
  totalCost: string;
  costPerNight: string;
  address: string;
};

type Tour = {
  id: string;
  date: string;
  name: string;
  startLocation: string;
  startTime: string;
  duration: string;
  cost: string;
  freeCancelBy: string;
  bookedOn: string;
  reference: string;
};

type ItineraryDetail = {
  id: string;
  day: number;
  time?: string | null;
  activity: string;
  cost?: number | null;
};

type OverviewTabProps = {
  backendUrl: string;
  headers: Record<string, string>;
  jsonHeaders: Record<string, string>;
  trip: Trip | null;
  group: GroupView | null;
  attendees: Array<{
    id: string;
    guestName?: string;
    email?: string;
    userEmail?: string;
    firstName?: string;
    lastName?: string;
  }>;
  flights: Flight[];
  lodgings: Lodging[];
  tours: Tour[];
  carRentals: CarRental[];
  defaultPayerId: string | null;
  styles: Record<string, any>;
  onRefreshTrips: () => void;
  onRefreshGroups: () => void;
  onRefreshFlights: () => void;
  onRefreshLodgings: () => void;
  onRefreshTours: () => void;
  onAddCarRental: (rental: CarRental) => void;
};

type ModalDateField =
  | 'flightDeparture'
  | 'lodgingCheckIn'
  | 'lodgingCheckOut'
  | 'lodgingRefundBy'
  | 'tourDate'
  | 'tourFreeCancel'
  | 'tourBookedOn'
  | 'rentalPickup'
  | 'rentalDropoff';

const OverviewTab: React.FC<OverviewTabProps> = ({
  backendUrl,
  headers,
  jsonHeaders,
  trip,
  group,
  attendees,
  flights,
  lodgings,
  tours,
  carRentals,
  defaultPayerId,
  styles,
  onRefreshTrips,
  onRefreshGroups,
  onRefreshFlights,
  onRefreshLodgings,
  onRefreshTours,
  onAddCarRental,
}) => {
  const [itineraryDetails, setItineraryDetails] = useState<ItineraryDetail[]>([]);
  const [itineraryLoading, setItineraryLoading] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [dateDraft, setDateDraft] = useState({
    mode: 'range' as 'range' | 'month',
    startDate: '',
    endDate: '',
    startMonth: '',
    startYear: '',
    durationDays: '',
  });
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
  const [selectedLodging, setSelectedLodging] = useState<Lodging | null>(null);
  const [selectedTour, setSelectedTour] = useState<Tour | null>(null);
  const [showAddTraveler, setShowAddTraveler] = useState(false);
  const [travelerDraft, setTravelerDraft] = useState({ firstName: '', lastName: '', email: '' });
  const [showAddFlight, setShowAddFlight] = useState(false);
  const [showAddLodging, setShowAddLodging] = useState(false);
  const [showAddTour, setShowAddTour] = useState(false);
  const [showAddRental, setShowAddRental] = useState(false);
  const [flightDraft, setFlightDraft] = useState<FlightCreateDraft>(createInitialFlightCreateDraft());
  const [lodgingDraft, setLodgingDraft] = useState<LodgingDraft>(createInitialLodgingState());
  const [tourDraft, setTourDraft] = useState<TourDraft>(createInitialTourState());
  const [rentalDraft, setRentalDraft] = useState<CarRentalDraft>(createInitialCarRentalDraft());
  const autoAdjustedRef = useRef<string | null>(null);
  const [dateField, setDateField] = useState<'start' | 'end' | null>(null);
  const [dateValue, setDateValue] = useState<Date>(new Date());
  const startDateRef = useRef<HTMLInputElement | null>(null);
  const endDateRef = useRef<HTMLInputElement | null>(null);
  const [modalDateField, setModalDateField] = useState<ModalDateField | null>(null);
  const [modalDateValue, setModalDateValue] = useState<Date>(new Date());

  const resetDrafts = () => {
    if (!trip) return;
    setDescriptionDraft(trip.description ?? '');
    if (trip.startDate || trip.endDate) {
      setDateDraft({
        mode: 'range',
        startDate: trip.startDate ?? '',
        endDate: trip.endDate ?? '',
        startMonth: '',
        startYear: '',
        durationDays: '',
      });
      return;
    }
    setDateDraft({
      mode: 'month',
      startDate: '',
      endDate: '',
      startMonth: trip.startMonth ? String(trip.startMonth) : '',
      startYear: trip.startYear ? String(trip.startYear) : '',
      durationDays: trip.durationDays ? String(trip.durationDays) : '',
    });
  };

  useEffect(() => {
    if (!trip) return;
    resetDrafts();
  }, [trip]);

  useEffect(() => {
    const loadItinerary = async () => {
      if (!trip?.id) {
        setItineraryDetails([]);
        return;
      }
      setItineraryLoading(true);
      try {
        const res = await fetch(`${backendUrl}/api/itineraries`, { headers });
        if (!res.ok) {
          setItineraryDetails([]);
          return;
        }
        const data = await res.json();
        const records = (Array.isArray(data) ? data : []).filter((i) => i.tripId === trip.id);
        if (!records.length) {
          setItineraryDetails([]);
          return;
        }
        const latest = records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        const detailsRes = await fetch(`${backendUrl}/api/itineraries/${latest.id}/details`, { headers });
        if (!detailsRes.ok) {
          setItineraryDetails([]);
          return;
        }
        const details = await detailsRes.json();
        setItineraryDetails(Array.isArray(details) ? details : []);
      } catch {
        setItineraryDetails([]);
      } finally {
        setItineraryLoading(false);
      }
    };
    loadItinerary();
  }, [backendUrl, headers, trip?.id]);

  const earliestEventDate = useMemo(
    () =>
      getEarliestTripEventDate([
        ...flights.map((f) => f.departure_date),
        ...lodgings.map((l) => l.checkInDate),
        ...tours.map((t) => t.date),
      ]),
    [flights, lodgings, tours]
  );

  const effectiveRangeDates = useMemo(
    () => adjustStartDateForEarliest({ startDate: trip?.startDate ?? null, endDate: trip?.endDate ?? null, earliestDate: earliestEventDate }),
    [trip?.startDate, trip?.endDate, earliestEventDate]
  );

  const displayStartDate = effectiveRangeDates.startDate ?? trip?.startDate ?? null;
  const displayEndDate = effectiveRangeDates.endDate ?? trip?.endDate ?? null;
  const monthLabel = useMemo(
    () => formatMonthYear(trip?.startMonth ?? null, trip?.startYear ?? null),
    [trip?.startMonth, trip?.startYear]
  );

  const tripLength = useMemo(() => {
    if (trip?.startDate || trip?.endDate) {
      return computeTripDays(displayStartDate ?? null, displayEndDate ?? null);
    }
    return trip?.durationDays ?? null;
  }, [trip, displayStartDate, displayEndDate]);

  const rows = useMemo<OverviewRow[]>(
    () =>
      buildOverviewRows({
        tripStartDate: effectiveRangeDates.startDate ?? trip?.startDate ?? null,
        tripMonthLabel: monthLabel,
        itineraryDetails,
        flights,
        lodgings,
        tours,
        rentals: carRentals,
      }),
    [effectiveRangeDates.startDate, trip?.startDate, monthLabel, itineraryDetails, flights, lodgings, tours, carRentals]
  );

  useEffect(() => {
    if (!trip?.id || !trip.startDate) return;
    if (autoAdjustedRef.current === trip.id) return;
    if (!effectiveRangeDates.startDate || effectiveRangeDates.startDate === trip.startDate) return;
    const run = async () => {
      const res = await fetch(`${backendUrl}/api/trips/${trip.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          dateMode: 'range',
          startDate: effectiveRangeDates.startDate,
          endDate: effectiveRangeDates.endDate ?? null,
        }),
      });
      if (res.ok) {
        autoAdjustedRef.current = trip.id;
        onRefreshTrips();
      }
    };
    run().catch(() => undefined);
  }, [backendUrl, headers, trip?.id, trip?.startDate, effectiveRangeDates.startDate, effectiveRangeDates.endDate, onRefreshTrips]);

  const openDatePicker = (field: 'start' | 'end') => {
    if (Platform.OS !== 'web' && NativeDateTimePicker) {
      const base = field === 'start' ? dateDraft.startDate : dateDraft.endDate;
      const date = base ? new Date(base) : new Date();
      setDateValue(date);
      setDateField(field);
      return;
    }
    const ref = field === 'start' ? startDateRef.current : endDateRef.current;
    if ((ref as any)?.showPicker) {
      (ref as any).showPicker();
      return;
    }
    if (typeof ref?.click === 'function') {
      ref.click();
      return;
    }
    ref?.focus();
  };

  const openModalDatePicker = (field: ModalDateField, current?: string) => {
    if (Platform.OS !== 'web' && NativeDateTimePicker) {
      const base = current?.trim() ? new Date(current) : new Date();
      setModalDateValue(base);
      setModalDateField(field);
    }
  };

  const saveOverviewEdits = async () => {
    if (!trip?.id) return;
    const validationError = validateTripDates({
      mode: dateDraft.mode,
      startDate: dateDraft.startDate,
      endDate: dateDraft.endDate,
      startMonth: dateDraft.startMonth,
      startYear: dateDraft.startYear,
      durationDays: dateDraft.durationDays,
    });
    if (validationError) {
      alert(validationError);
      return;
    }
    const payload: any = {
      description: descriptionDraft,
      dateMode: dateDraft.mode,
    };
    if (dateDraft.mode === 'range') {
      const adjusted = adjustStartDateForEarliest({
        startDate: dateDraft.startDate || null,
        endDate: dateDraft.endDate || null,
        earliestDate: earliestEventDate,
      });
      payload.startDate = adjusted.startDate ?? null;
      payload.endDate = adjusted.endDate ?? null;
    } else {
      payload.startMonth = Number(dateDraft.startMonth) || null;
      payload.startYear = Number(dateDraft.startYear) || null;
      payload.durationDays = Number(dateDraft.durationDays) || null;
    }
    const res = await fetch(`${backendUrl}/api/trips/${trip.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to update trip');
      return;
    }
    setIsEditing(false);
    onRefreshTrips();
  };

  const removeTraveler = async (memberId: string) => {
    if (!group?.id) return;
    const res = await fetch(`${backendUrl}/api/groups/${group.id}/members/${memberId}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to remove member');
      return;
    }
    onRefreshGroups();
  };

  const addTraveler = async () => {
    if (!group?.id) return;
    const first = travelerDraft.firstName.trim();
    const last = travelerDraft.lastName.trim();
    const email = travelerDraft.email.trim();
    if (!first || !last) {
      alert('Enter first and last name');
      return;
    }
    const payload = email ? { email } : { guestName: `${first} ${last}`.trim() };
    const res = await fetch(`${backendUrl}/api/groups/${group.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to add member');
      return;
    }
    setTravelerDraft({ firstName: '', lastName: '', email: '' });
    setShowAddTraveler(false);
    onRefreshGroups();
  };

  const saveNewFlight = async () => {
    const result = await createFlightForTrip({
      backendUrl,
      headers,
      draft: flightDraft,
      tripId: trip?.id ?? null,
      defaultPayerId,
    });
    if (!result.ok) {
      alert(result.error || 'Unable to save flight');
      return;
    }
    setShowAddFlight(false);
    setFlightDraft(createInitialFlightCreateDraft());
    onRefreshFlights();
  };

  const saveNewLodging = async () => {
    const result = await createLodgingForTrip({
      backendUrl,
      jsonHeaders,
      draft: lodgingDraft,
      activeTripId: trip?.id ?? null,
      defaultPayerId,
    });
    if (!result.ok) {
      alert(result.error || 'Unable to save lodging');
      return;
    }
    setShowAddLodging(false);
    setLodgingDraft(createInitialLodgingState());
    onRefreshLodgings();
  };

  const saveNewTour = async () => {
    const result = await createTourForTrip({
      backendUrl,
      jsonHeaders,
      draft: tourDraft,
      activeTripId: trip?.id ?? null,
      defaultPayerId,
    });
    if (!result.ok) {
      alert(result.error || 'Unable to save tour');
      return;
    }
    setShowAddTour(false);
    setTourDraft(createInitialTourState());
    onRefreshTours();
  };

  const saveNewRental = () => {
    const result = buildCarRentalFromDraft(rentalDraft, defaultPayerId);
    if (!result.rental || result.error) {
      alert(result.error || 'Unable to save rental car');
      return;
    }
    onAddCarRental(result.rental);
    setShowAddRental(false);
    setRentalDraft(createInitialCarRentalDraft());
  };

  const renderDetailModal = (title: string, items: Array<{ label: string; value: string }>, onClose: () => void) => (
    <View style={styles.modalOverlay}>
      <View style={styles.confirmModal}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {items.map((item) => (
          <View key={item.label} style={styles.row}>
            <Text style={styles.headerText}>{item.label}:</Text>
            <Text style={[styles.bodyText, { marginLeft: 6 }]}>{item.value}</Text>
          </View>
        ))}
        <TouchableOpacity style={styles.button} onPress={onClose}>
          <Text style={styles.buttonText}>Close</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (!trip) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Overview</Text>
        <Text style={styles.helperText}>Select a trip to view its overview.</Text>
      </View>
    );
  }

  const dateRange = displayStartDate || displayEndDate
    ? `${displayStartDate ? formatDateLong(displayStartDate) : 'Start'} - ${displayEndDate ? formatDateLong(displayEndDate) : 'End'}`
    : null;
  const attendeeLabel = (member: OverviewTabProps['attendees'][number]) => {
    const first = member.firstName?.trim() ?? '';
    const last = member.lastName?.trim() ?? '';
    const combined = `${first} ${last}`.trim();
    if (combined) return combined;
    if (member.guestName?.trim()) return member.guestName.trim();
    return 'Traveler';
  };

  return (
    <ScrollView style={styles.card} contentContainerStyle={{ gap: 12 }}>
      <View style={styles.row}>
        <Text style={styles.sectionTitle}>Overview</Text>
        {!isEditing ? (
          <TouchableOpacity style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]} onPress={() => setIsEditing(true)}>
            <Text style={styles.buttonText}>Edit</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={[styles.button, { marginLeft: 'auto' }]} onPress={saveOverviewEdits}>
              <Text style={styles.buttonText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.dangerButton]}
              onPress={() => {
                resetDrafts();
                setIsEditing(false);
              }}
            >
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
      <Text style={styles.flightTitle}>{trip.name}</Text>
      {trip.destination ? <Text style={styles.helperText}>Destination: {trip.destination}</Text> : null}
      {dateRange ? <Text style={styles.helperText}>Dates: {dateRange}</Text> : null}
      {!dateRange && monthLabel && trip.durationDays ? (
        <Text style={styles.helperText}>
          Dates: {monthLabel} - {trip.durationDays} day(s)
        </Text>
      ) : null}
      {tripLength ? <Text style={styles.helperText}>Trip length: {tripLength} day(s)</Text> : null}

      <View style={[styles.row, { alignItems: 'flex-start' }]}>
        <Text style={styles.headerText}>Trip Dates</Text>
      </View>
      {isEditing ? (
        <View>
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.button, dateDraft.mode === 'range' && styles.toggleActive, styles.smallButton]}
              onPress={() => setDateDraft((prev) => ({ ...prev, mode: 'range' }))}
            >
              <Text style={styles.buttonText}>Start + End</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, dateDraft.mode === 'month' && styles.toggleActive, styles.smallButton]}
              onPress={() => setDateDraft((prev) => ({ ...prev, mode: 'month' }))}
            >
              <Text style={styles.buttonText}>Month + Days</Text>
            </TouchableOpacity>
          </View>
          {dateDraft.mode === 'range' ? (
            <>
              <View style={styles.dateInputWrap}>
                {Platform.OS === 'web' ? (
                  <input
                    ref={startDateRef as any}
                    type="date"
                    value={dateDraft.startDate}
                    onChange={(e) =>
                      setDateDraft((prev) => ({ ...prev, startDate: normalizeDateString(e.target.value) }))
                    }
                    style={styles.input as any}
                  />
                ) : (
                  <TouchableOpacity style={[styles.input, styles.dateTouchable]} onPress={() => openDatePicker('start')}>
                    <Text style={styles.cellText}>{dateDraft.startDate || 'YYYY-MM-DD'}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.dateIcon} onPress={() => openDatePicker('start')}>
                  <Text style={styles.selectCaret}>v</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.dateInputWrap}>
                {Platform.OS === 'web' ? (
                  <input
                    ref={endDateRef as any}
                    type="date"
                    value={dateDraft.endDate}
                    onChange={(e) =>
                      setDateDraft((prev) => ({ ...prev, endDate: normalizeDateString(e.target.value) }))
                    }
                    style={styles.input as any}
                  />
                ) : (
                  <TouchableOpacity style={[styles.input, styles.dateTouchable]} onPress={() => openDatePicker('end')}>
                    <Text style={styles.cellText}>{dateDraft.endDate || 'YYYY-MM-DD'}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.dateIcon} onPress={() => openDatePicker('end')}>
                  <Text style={styles.selectCaret}>v</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Month (1-12)"
                  keyboardType="numeric"
                  value={dateDraft.startMonth}
                  onChangeText={(text) => setDateDraft((prev) => ({ ...prev, startMonth: text }))}
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Year (YYYY)"
                  keyboardType="numeric"
                  value={dateDraft.startYear}
                  onChangeText={(text) => setDateDraft((prev) => ({ ...prev, startYear: text }))}
                />
              </View>
              <TextInput
                style={styles.input}
                placeholder="Number of days"
                keyboardType="numeric"
                value={dateDraft.durationDays}
                onChangeText={(text) => setDateDraft((prev) => ({ ...prev, durationDays: text }))}
              />
            </>
          )}
        </View>
      ) : null}

      <View style={[styles.row, { alignItems: 'flex-start' }]}>
        <Text style={styles.headerText}>Description</Text>
      </View>
      {!isEditing ? (
        trip.description ? (
          <View>
            {renderRichTextBlocks(trip.description, {
              base: styles.bodyText,
              bold: styles.headerText,
              italic: styles.helperText,
              link: styles.linkText ?? styles.buttonText,
              listItem: styles.helperText,
            })}
          </View>
        ) : (
          <Text style={styles.helperText}>No description yet.</Text>
        )
      ) : (
        <View>
          <TextInput
            style={[styles.input, { minHeight: 120 }]}
            multiline
            value={descriptionDraft}
            onChangeText={setDescriptionDraft}
          />
        </View>
      )}

      <View style={styles.divider} />
      <View style={styles.row}>
        <Text style={styles.headerText}>Attendees</Text>
        {isEditing ? (
          <TouchableOpacity style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]} onPress={() => setShowAddTraveler((prev) => !prev)}>
            <Text style={styles.buttonText}>Add Traveler</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
        {(attendees ?? []).map((m) => (
          <TouchableOpacity key={m.id} style={[styles.button, styles.smallButton]} onPress={() => removeTraveler(m.id)}>
            <Text style={styles.buttonText}>
              {attendeeLabel(m)} <Text style={styles.removeText}>x</Text>
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {isEditing && showAddTraveler ? (
        <View style={{ marginTop: 8 }}>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="First name"
              value={travelerDraft.firstName}
              onChangeText={(text) => setTravelerDraft((prev) => ({ ...prev, firstName: text }))}
            />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Last name"
              value={travelerDraft.lastName}
              onChangeText={(text) => setTravelerDraft((prev) => ({ ...prev, lastName: text }))}
            />
          </View>
          <TextInput
            style={styles.input}
            placeholder="Email (optional)"
            autoCapitalize="none"
            value={travelerDraft.email}
            onChangeText={(text) => setTravelerDraft((prev) => ({ ...prev, email: text }))}
          />
          <View style={styles.row}>
            <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={addTraveler}>
              <Text style={styles.buttonText}>Add</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.dangerButton, { flex: 1 }]}
              onPress={() => {
                setShowAddTraveler(false);
                setTravelerDraft({ firstName: '', lastName: '', email: '' });
              }}
            >
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {isEditing ? (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.headerText}>Add Trip Items</Text>
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => setShowAddFlight(true)}>
              <Text style={styles.buttonText}>Add Flight</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => setShowAddLodging(true)}>
              <Text style={styles.buttonText}>Add Lodging</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => setShowAddRental(true)}>
              <Text style={styles.buttonText}>Add Rental Car</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => setShowAddTour(true)}>
              <Text style={styles.buttonText}>Add Tour</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={styles.divider} />
      <Text style={styles.headerText}>Itinerary</Text>
      {itineraryLoading ? <Text style={styles.helperText}>Loading itinerary...</Text> : null}
      {!itineraryLoading && !rows.length ? <Text style={styles.helperText}>No itinerary items yet.</Text> : null}
      {rows.length ? (
        <View>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <View style={[styles.cell, { minWidth: 70 }]}>
              <Text style={styles.headerText}>Day</Text>
            </View>
            <View style={[styles.cell, { minWidth: 110 }]}>
              <Text style={styles.headerText}>Date</Text>
            </View>
            <View style={[styles.cell, { flex: 1 }]}>
              <Text style={styles.headerText}>Item</Text>
            </View>
          </View>
          {rows.map((row, idx) => {
            const prev = rows[idx - 1];
            const showDay = !prev || prev.dayLabel !== row.dayLabel || prev.dateLabel !== row.dateLabel;
            return (
              <View key={`${row.type}-${row.label}-${idx}`} style={styles.tableRow}>
                <View style={[styles.cell, { minWidth: 70 }]}>
                  {showDay ? <Text style={styles.cellText}>{row.dayLabel}</Text> : null}
                </View>
                <View style={[styles.cell, { minWidth: 110 }]}>
                  {showDay ? <Text style={styles.cellText}>{row.dateLabel}</Text> : null}
                </View>
                <View style={[styles.cell, { flex: 1 }]}>
                  <Text style={styles.cellText}>{row.label}</Text>
                  {row.type === 'flight' ? (
                    <TouchableOpacity onPress={() => setSelectedFlight(row.meta)}>
                      <Text style={styles.linkText}>View details</Text>
                    </TouchableOpacity>
                  ) : null}
                  {row.type === 'lodging' ? (
                    <TouchableOpacity onPress={() => setSelectedLodging(row.meta)}>
                      <Text style={styles.linkText}>View details</Text>
                    </TouchableOpacity>
                  ) : null}
                  {row.type === 'tour' ? (
                    <TouchableOpacity onPress={() => setSelectedTour(row.meta)}>
                      <Text style={styles.linkText}>View details</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {selectedFlight
        ? renderDetailModal('Flight Details', formatFlightDetails(selectedFlight), () => setSelectedFlight(null))
        : null}
      {selectedLodging
        ? renderDetailModal('Lodging Details', formatLodgingDetails(selectedLodging), () => setSelectedLodging(null))
        : null}
      {selectedTour ? renderDetailModal('Tour Details', formatTourDetails(selectedTour), () => setSelectedTour(null)) : null}
      {showAddFlight ? (
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModal}>
            <Text style={styles.sectionTitle}>Add Flight</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              <Text style={styles.modalLabel}>Passenger</Text>
              <TextInput
                style={styles.input}
                placeholder="Passenger name"
                value={flightDraft.passengerName}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, passengerName: text }))}
              />
              <Text style={styles.modalLabel}>Departure date</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={flightDraft.departureDate}
                  onChange={(e) =>
                    setFlightDraft((prev) => ({ ...prev, departureDate: normalizeDateString(e.target.value) }))
                  }
                  style={styles.input as any}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openModalDatePicker('flightDeparture', flightDraft.departureDate)}>
                  <Text style={styles.cellText}>{flightDraft.departureDate || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Departure airport code</Text>
              <TextInput
                style={styles.input}
                placeholder="JFK"
                value={flightDraft.departureAirportCode}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, departureAirportCode: text }))}
              />
              <Text style={styles.modalLabel}>Departure time</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="time"
                  value={flightDraft.departureTime}
                  onChange={(e) => setFlightDraft((prev) => ({ ...prev, departureTime: e.target.value }))}
                  style={styles.input as any}
                />
              ) : (
                <TextInput
                  style={styles.input}
                  placeholder="HH:MM"
                  value={flightDraft.departureTime}
                  onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, departureTime: text }))}
                />
              )}
              <Text style={styles.modalLabel}>Arrival airport code</Text>
              <TextInput
                style={styles.input}
                placeholder="LAX"
                value={flightDraft.arrivalAirportCode}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, arrivalAirportCode: text }))}
              />
              <Text style={styles.modalLabel}>Arrival time</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="time"
                  value={flightDraft.arrivalTime}
                  onChange={(e) => setFlightDraft((prev) => ({ ...prev, arrivalTime: e.target.value }))}
                  style={styles.input as any}
                />
              ) : (
                <TextInput
                  style={styles.input}
                  placeholder="HH:MM"
                  value={flightDraft.arrivalTime}
                  onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, arrivalTime: text }))}
                />
              )}
              <Text style={styles.modalLabel}>Carrier</Text>
              <TextInput
                style={styles.input}
                placeholder="Delta"
                value={flightDraft.carrier}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, carrier: text }))}
              />
              <Text style={styles.modalLabel}>Flight number</Text>
              <TextInput
                style={styles.input}
                placeholder="DL123"
                value={flightDraft.flightNumber}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, flightNumber: text }))}
              />
              <Text style={styles.modalLabel}>Booking reference</Text>
              <TextInput
                style={styles.input}
                placeholder="ABC123"
                value={flightDraft.bookingReference}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, bookingReference: text }))}
              />
              <Text style={styles.modalLabel}>Layover location</Text>
              <TextInput
                style={styles.input}
                placeholder="Chicago"
                value={flightDraft.layoverLocation}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, layoverLocation: text }))}
              />
              <Text style={styles.modalLabel}>Layover airport code</Text>
              <TextInput
                style={styles.input}
                placeholder="ORD"
                value={flightDraft.layoverLocationCode}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, layoverLocationCode: text }))}
              />
              <Text style={styles.modalLabel}>Layover duration</Text>
              <TextInput
                style={styles.input}
                placeholder="1h 20m"
                value={flightDraft.layoverDuration}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, layoverDuration: text }))}
              />
              <Text style={styles.modalLabel}>Cost</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                keyboardType="numeric"
                value={flightDraft.cost}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, cost: text }))}
              />
            </ScrollView>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={() => setShowAddFlight(false)}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={saveNewFlight}>
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
      {showAddLodging ? (
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModal}>
            <Text style={styles.sectionTitle}>Add Lodging</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              <Text style={styles.modalLabel}>Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Hotel name"
                value={lodgingDraft.name}
                onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, name: text }))}
              />
              <Text style={styles.modalLabel}>Check-in date</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={lodgingDraft.checkInDate}
                  onChange={(e) =>
                    setLodgingDraft((prev) => ({ ...prev, checkInDate: normalizeDateString(e.target.value) }))
                  }
                  style={styles.input as any}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openModalDatePicker('lodgingCheckIn', lodgingDraft.checkInDate)}>
                  <Text style={styles.cellText}>{lodgingDraft.checkInDate || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Check-out date</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={lodgingDraft.checkOutDate}
                  onChange={(e) =>
                    setLodgingDraft((prev) => ({ ...prev, checkOutDate: normalizeDateString(e.target.value) }))
                  }
                  style={styles.input as any}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openModalDatePicker('lodgingCheckOut', lodgingDraft.checkOutDate)}>
                  <Text style={styles.cellText}>{lodgingDraft.checkOutDate || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <View style={styles.modalRow}>
                <Text style={styles.modalLabel}>Refund by</Text>
                <TouchableOpacity onPress={() => setLodgingDraft((prev) => ({ ...prev, refundBy: '' }))}>
                  <Text style={styles.linkText}>Clear</Text>
                </TouchableOpacity>
              </View>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={lodgingDraft.refundBy}
                  onChange={(e) =>
                    setLodgingDraft((prev) => ({ ...prev, refundBy: normalizeDateString(e.target.value) }))
                  }
                  style={styles.input as any}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openModalDatePicker('lodgingRefundBy', lodgingDraft.refundBy)}>
                  <Text style={styles.cellText}>{lodgingDraft.refundBy || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Rooms</Text>
              <TextInput
                style={styles.input}
                placeholder="1"
                keyboardType="numeric"
                value={lodgingDraft.rooms}
                onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, rooms: text }))}
              />
              <Text style={styles.modalLabel}>Total cost</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                keyboardType="numeric"
                value={lodgingDraft.totalCost}
                onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, totalCost: text }))}
              />
              <Text style={styles.modalLabel}>Address</Text>
              <TextInput
                style={styles.input}
                placeholder="Address"
                value={lodgingDraft.address}
                onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, address: text }))}
              />
            </ScrollView>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={() => setShowAddLodging(false)}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={saveNewLodging}>
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
      {showAddTour ? (
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModal}>
            <Text style={styles.sectionTitle}>Add Tour</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              <Text style={styles.modalLabel}>Date</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={tourDraft.date}
                  onChange={(e) =>
                    setTourDraft((prev) => ({ ...prev, date: normalizeDateString(e.target.value) }))
                  }
                  style={styles.input as any}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openModalDatePicker('tourDate', tourDraft.date)}>
                  <Text style={styles.cellText}>{tourDraft.date || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Tour name</Text>
              <TextInput
                style={styles.input}
                placeholder="Tour name"
                value={tourDraft.name}
                onChangeText={(text) => setTourDraft((prev) => ({ ...prev, name: text }))}
              />
              <Text style={styles.modalLabel}>Start location</Text>
              <TextInput
                style={styles.input}
                placeholder="Start location"
                value={tourDraft.startLocation}
                onChangeText={(text) => setTourDraft((prev) => ({ ...prev, startLocation: text }))}
              />
              <Text style={styles.modalLabel}>Start time</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="time"
                  value={tourDraft.startTime}
                  onChange={(e) => setTourDraft((prev) => ({ ...prev, startTime: e.target.value }))}
                  style={styles.input as any}
                />
              ) : (
                <TextInput
                  style={styles.input}
                  placeholder="HH:MM"
                  value={tourDraft.startTime}
                  onChangeText={(text) => setTourDraft((prev) => ({ ...prev, startTime: text }))}
                />
              )}
              <Text style={styles.modalLabel}>Duration</Text>
              <TextInput
                style={styles.input}
                placeholder="2 hours"
                value={tourDraft.duration}
                onChangeText={(text) => setTourDraft((prev) => ({ ...prev, duration: text }))}
              />
              <Text style={styles.modalLabel}>Cost</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                keyboardType="numeric"
                value={tourDraft.cost}
                onChangeText={(text) => setTourDraft((prev) => ({ ...prev, cost: text }))}
              />
              <View style={styles.modalRow}>
                <Text style={styles.modalLabel}>Free cancel by</Text>
                <TouchableOpacity onPress={() => setTourDraft((prev) => ({ ...prev, freeCancelBy: '' }))}>
                  <Text style={styles.linkText}>Clear</Text>
                </TouchableOpacity>
              </View>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={tourDraft.freeCancelBy}
                  onChange={(e) =>
                    setTourDraft((prev) => ({ ...prev, freeCancelBy: normalizeDateString(e.target.value) }))
                  }
                  style={styles.input as any}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openModalDatePicker('tourFreeCancel', tourDraft.freeCancelBy)}>
                  <Text style={styles.cellText}>{tourDraft.freeCancelBy || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <View style={styles.modalRow}>
                <Text style={styles.modalLabel}>Booked on</Text>
                <TouchableOpacity onPress={() => setTourDraft((prev) => ({ ...prev, bookedOn: '' }))}>
                  <Text style={styles.linkText}>Clear</Text>
                </TouchableOpacity>
              </View>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={tourDraft.bookedOn}
                  onChange={(e) =>
                    setTourDraft((prev) => ({ ...prev, bookedOn: normalizeDateString(e.target.value) }))
                  }
                  style={styles.input as any}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openModalDatePicker('tourBookedOn', tourDraft.bookedOn)}>
                  <Text style={styles.cellText}>{tourDraft.bookedOn || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Reference</Text>
              <TextInput
                style={styles.input}
                placeholder="Reference"
                value={tourDraft.reference}
                onChangeText={(text) => setTourDraft((prev) => ({ ...prev, reference: text }))}
              />
            </ScrollView>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={() => setShowAddTour(false)}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={saveNewTour}>
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
      {showAddRental ? (
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModal}>
            <Text style={styles.sectionTitle}>Add Rental Car</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              <Text style={styles.modalLabel}>Pickup location</Text>
              <TextInput
                style={styles.input}
                placeholder="Pickup location"
                value={rentalDraft.pickupLocation}
                onChangeText={(text) => setRentalDraft((prev) => ({ ...prev, pickupLocation: text }))}
              />
              <Text style={styles.modalLabel}>Pickup date</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={rentalDraft.pickupDate}
                  onChange={(e) =>
                    setRentalDraft((prev) => ({ ...prev, pickupDate: normalizeDateString(e.target.value) }))
                  }
                  style={styles.input as any}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openModalDatePicker('rentalPickup', rentalDraft.pickupDate)}>
                  <Text style={styles.cellText}>{rentalDraft.pickupDate || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Dropoff location</Text>
              <TextInput
                style={styles.input}
                placeholder="Dropoff location"
                value={rentalDraft.dropoffLocation}
                onChangeText={(text) => setRentalDraft((prev) => ({ ...prev, dropoffLocation: text }))}
              />
              <Text style={styles.modalLabel}>Dropoff date</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={rentalDraft.dropoffDate}
                  onChange={(e) =>
                    setRentalDraft((prev) => ({ ...prev, dropoffDate: normalizeDateString(e.target.value) }))
                  }
                  style={styles.input as any}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openModalDatePicker('rentalDropoff', rentalDraft.dropoffDate)}>
                  <Text style={styles.cellText}>{rentalDraft.dropoffDate || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Vendor</Text>
              <TextInput
                style={styles.input}
                placeholder="Vendor"
                value={rentalDraft.vendor}
                onChangeText={(text) => setRentalDraft((prev) => ({ ...prev, vendor: text }))}
              />
              <Text style={styles.modalLabel}>Car model</Text>
              <TextInput
                style={styles.input}
                placeholder="SUV"
                value={rentalDraft.model}
                onChangeText={(text) => setRentalDraft((prev) => ({ ...prev, model: text }))}
              />
              <Text style={styles.modalLabel}>Reference</Text>
              <TextInput
                style={styles.input}
                placeholder="Reference"
                value={rentalDraft.reference}
                onChangeText={(text) => setRentalDraft((prev) => ({ ...prev, reference: text }))}
              />
              <Text style={styles.modalLabel}>Prepaid</Text>
              <TextInput
                style={styles.input}
                placeholder="Yes/No"
                value={rentalDraft.prepaid}
                onChangeText={(text) => setRentalDraft((prev) => ({ ...prev, prepaid: text }))}
              />
              <Text style={styles.modalLabel}>Cost</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                keyboardType="numeric"
                value={rentalDraft.cost}
                onChangeText={(text) => setRentalDraft((prev) => ({ ...prev, cost: text }))}
              />
              <Text style={styles.modalLabel}>Notes</Text>
              <TextInput
                style={styles.input}
                placeholder="Notes"
                value={rentalDraft.notes}
                onChangeText={(text) => setRentalDraft((prev) => ({ ...prev, notes: text }))}
                multiline
              />
            </ScrollView>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={() => setShowAddRental(false)}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={saveNewRental}>
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
      {Platform.OS !== 'web' && dateField && NativeDateTimePicker ? (
        <NativeDateTimePicker
          value={dateValue}
          mode="date"
          onChange={(_, date) => {
            if (!date) {
              setDateField(null);
              return;
            }
            const iso = date.toISOString().slice(0, 10);
            if (dateField === 'start') {
              setDateDraft((prev) => ({ ...prev, startDate: iso }));
            } else {
              setDateDraft((prev) => ({ ...prev, endDate: iso }));
            }
            setDateField(null);
          }}
        />
      ) : null}
      {Platform.OS !== 'web' && modalDateField && NativeDateTimePicker ? (
        <NativeDateTimePicker
          value={modalDateValue}
          mode="date"
          onChange={(_, date) => {
            if (!date) {
              setModalDateField(null);
              return;
            }
            const iso = date.toISOString().slice(0, 10);
            if (modalDateField === 'flightDeparture') {
              setFlightDraft((prev) => ({ ...prev, departureDate: iso }));
            } else if (modalDateField === 'lodgingCheckIn') {
              setLodgingDraft((prev) => ({ ...prev, checkInDate: iso }));
            } else if (modalDateField === 'lodgingCheckOut') {
              setLodgingDraft((prev) => ({ ...prev, checkOutDate: iso }));
            } else if (modalDateField === 'lodgingRefundBy') {
              setLodgingDraft((prev) => ({ ...prev, refundBy: iso }));
            } else if (modalDateField === 'tourDate') {
              setTourDraft((prev) => ({ ...prev, date: iso }));
            } else if (modalDateField === 'tourFreeCancel') {
              setTourDraft((prev) => ({ ...prev, freeCancelBy: iso }));
            } else if (modalDateField === 'tourBookedOn') {
              setTourDraft((prev) => ({ ...prev, bookedOn: iso }));
            } else if (modalDateField === 'rentalPickup') {
              setRentalDraft((prev) => ({ ...prev, pickupDate: iso }));
            } else if (modalDateField === 'rentalDropoff') {
              setRentalDraft((prev) => ({ ...prev, dropoffDate: iso }));
            }
            setModalDateField(null);
          }}
        />
      ) : null}
    </ScrollView>
  );
};

export default OverviewTab;
