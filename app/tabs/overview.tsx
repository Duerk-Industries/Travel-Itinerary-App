import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { computeTripDays } from '../utils/createTripWizard';
import { formatDateLong } from '../utils/formatDateLong';
import { renderRichTextBlocks } from '../utils/richText';
import {
  buildOverviewRows,
  formatFlightDetails,
  formatLodgingDetails,
  formatTourDetails,
  type OverviewRow,
} from '../utils/overviewBuilder';

type Trip = {
  id: string;
  groupId: string;
  name: string;
  description?: string | null;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
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
  trip: Trip | null;
  group: GroupView | null;
  flights: Flight[];
  lodgings: Lodging[];
  tours: Tour[];
  styles: Record<string, any>;
  onRefreshTrips: () => void;
  onRefreshGroups: () => void;
};

const OverviewTab: React.FC<OverviewTabProps> = ({
  backendUrl,
  headers,
  trip,
  group,
  flights,
  lodgings,
  tours,
  styles,
  onRefreshTrips,
  onRefreshGroups,
}) => {
  const [itineraryDetails, setItineraryDetails] = useState<ItineraryDetail[]>([]);
  const [itineraryLoading, setItineraryLoading] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
  const [selectedLodging, setSelectedLodging] = useState<Lodging | null>(null);
  const [selectedTour, setSelectedTour] = useState<Tour | null>(null);
  const [showAddTraveler, setShowAddTraveler] = useState(false);
  const [travelerDraft, setTravelerDraft] = useState({ firstName: '', lastName: '', email: '' });

  useEffect(() => {
    setDescriptionDraft(trip?.description ?? '');
  }, [trip?.description]);

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

  const tripLength = useMemo(() => computeTripDays(trip?.startDate ?? null, trip?.endDate ?? null), [trip]);

  const rows = useMemo<OverviewRow[]>(
    () =>
      buildOverviewRows({
        tripStartDate: trip?.startDate ?? null,
        itineraryDetails,
        flights,
        lodgings,
        tours,
      }),
    [trip?.startDate, itineraryDetails, flights, lodgings, tours]
  );

  const saveDescription = async () => {
    if (!trip?.id) return;
    const res = await fetch(`${backendUrl}/api/trips/${trip.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ description: descriptionDraft }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to update description');
      return;
    }
    setEditingDescription(false);
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

  const dateRange = trip.startDate || trip.endDate
    ? `${trip.startDate ? formatDateLong(trip.startDate) : 'Start'} - ${trip.endDate ? formatDateLong(trip.endDate) : 'End'}`
    : null;

  return (
    <ScrollView style={styles.card} contentContainerStyle={{ gap: 12 }}>
      <Text style={styles.sectionTitle}>Overview</Text>
      <Text style={styles.flightTitle}>{trip.name}</Text>
      {trip.destination ? <Text style={styles.helperText}>Destination: {trip.destination}</Text> : null}
      {dateRange ? <Text style={styles.helperText}>Dates: {dateRange}</Text> : null}
      {tripLength ? <Text style={styles.helperText}>Trip length: {tripLength} day(s)</Text> : null}

      <View style={[styles.row, { alignItems: 'flex-start' }]}>
        <Text style={styles.headerText}>Description</Text>
        {!editingDescription ? (
          <TouchableOpacity style={[styles.button, styles.smallButton, { marginLeft: 8 }]} onPress={() => setEditingDescription(true)}>
            <Text style={styles.buttonText}>Edit</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {!editingDescription ? (
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
          <View style={styles.row}>
            <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={saveDescription}>
              <Text style={styles.buttonText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.dangerButton, { flex: 1 }]}
              onPress={() => {
                setDescriptionDraft(trip.description ?? '');
                setEditingDescription(false);
              }}
            >
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.divider} />
      <View style={styles.row}>
        <Text style={styles.headerText}>Attendees</Text>
        <TouchableOpacity style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]} onPress={() => setShowAddTraveler((prev) => !prev)}>
          <Text style={styles.buttonText}>Add Traveler</Text>
        </TouchableOpacity>
      </View>
      <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
        {(group?.members ?? []).map((m) => (
          <TouchableOpacity key={m.id} style={[styles.button, styles.smallButton]} onPress={() => removeTraveler(m.id)}>
            <Text style={styles.buttonText}>
              {m.userEmail ?? m.email ?? m.guestName ?? 'Traveler'} <Text style={styles.removeText}>x</Text>
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {showAddTraveler ? (
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
    </ScrollView>
  );
};

export default OverviewTab;
