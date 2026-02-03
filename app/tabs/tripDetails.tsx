import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { formatDateLong } from '../utils/formatDateLong';
import { renderRichTextBlocks } from '../utils/richText';
import { formatMonthYear } from '../utils/tripDates';

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
  currency?: string | null;
  createdAt: string;
};

type GroupView = {
  id: string;
  name: string;
  members: Array<{ id: string; userEmail?: string; email?: string; guestName?: string }>;
  invites: Array<{ id: string; inviteeEmail: string; status: string }>;
};

type TripDetailsTabProps = {
  trip: Trip | null;
  group: GroupView | null;
  styles: Record<string, any>;
  onSetActive: (tripId: string) => void;
  onOpenItinerary: (tripId: string) => void;
  onUpdateCurrency: (tripId: string, currency: string) => void;
};

const TripDetailsTab: React.FC<TripDetailsTabProps> = ({ trip, group, styles, onSetActive, onOpenItinerary, onUpdateCurrency }) => {
  if (!trip) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Trip Details</Text>
        <Text style={styles.helperText}>This trip is no longer available.</Text>
      </View>
    );
  }

  const [showCurrencyDropdown, setShowCurrencyDropdown] = useState(false);
  const currencyOptions = useMemo(
    () => ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'MXN'],
    []
  );
  const currentCurrency = trip.currency ?? 'USD';

  const dateRange = trip.startDate || trip.endDate
    ? `${trip.startDate ? formatDateLong(trip.startDate) : 'Start'} - ${trip.endDate ? formatDateLong(trip.endDate) : 'End'}`
    : null;
  const monthLabel = formatMonthYear(trip.startMonth ?? null, trip.startYear ?? null);
  const pendingInvites = group?.invites ?? [];
  const members = group?.members ?? [];

  return (
    <ScrollView style={styles.card} contentContainerStyle={{ gap: 12 }}>
      <View style={styles.row}>
        <Text style={styles.sectionTitle}>Trip Details</Text>
      </View>
      <Text style={styles.flightTitle}>{trip.name}</Text>
      <Text style={styles.helperText}>Created: {formatDateLong(trip.createdAt)}</Text>
      {trip.destination ? <Text style={styles.helperText}>Destination: {trip.destination}</Text> : null}
      {dateRange ? <Text style={styles.helperText}>Dates: {dateRange}</Text> : null}
      {!dateRange && monthLabel && trip.durationDays ? (
        <Text style={styles.helperText}>
          Dates: {monthLabel} · {trip.durationDays} day(s)
        </Text>
      ) : null}
      {trip.description ? (
        <View style={{ marginTop: 8 }}>
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
      )}

      <View style={styles.divider} />
      <Text style={styles.headerText}>Currency</Text>
      <View style={[styles.input, styles.dropdown, { marginTop: 6 }]}>
        <TouchableOpacity style={styles.selectButtonRow} onPress={() => setShowCurrencyDropdown((prev) => !prev)}>
          <Text style={styles.cellText}>{currentCurrency}</Text>
          <Text style={styles.selectCaret}>▾</Text>
        </TouchableOpacity>
        {showCurrencyDropdown ? (
          <View style={styles.dropdownList}>
            {currencyOptions.map((currency) => (
              <TouchableOpacity
                key={currency}
                style={styles.dropdownOption}
                onPress={() => {
                  setShowCurrencyDropdown(false);
                  if (currency !== currentCurrency) {
                    onUpdateCurrency(trip.id, currency);
                  }
                }}
              >
                <Text style={styles.cellText}>{currency}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.divider} />
      <Text style={styles.headerText}>Participants</Text>
      {members.length ? (
        members.map((m) => (
          <Text key={m.id} style={styles.bodyText}>
            {m.userEmail ?? m.email ?? m.guestName ?? 'Traveler'}
          </Text>
        ))
      ) : (
        <Text style={styles.helperText}>No members listed yet.</Text>
      )}

      <View style={styles.divider} />
      <Text style={styles.headerText}>Pending Invites</Text>
      {pendingInvites.length ? (
        pendingInvites.map((inv) => (
          <Text key={inv.id} style={styles.bodyText}>
            {inv.inviteeEmail} (Pending)
          </Text>
        ))
      ) : (
        <Text style={styles.helperText}>No pending invites.</Text>
      )}

      <View style={styles.row}>
        <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={() => onSetActive(trip.id)}>
          <Text style={styles.buttonText}>Set Active Trip</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={() => onOpenItinerary(trip.id)}>
          <Text style={styles.buttonText}>Open Itinerary</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

export default TripDetailsTab;
