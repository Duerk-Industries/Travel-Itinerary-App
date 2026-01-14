import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { Trait } from './traits';
import { renderRichTextBlocks } from '../utils/richText';
import { parsePlanToDetails } from '../utils/itineraryParser';
import { computeDurationFromRange, formatMonthYear } from '../utils/tripDates';
import { normalizeDateString } from '../utils/normalizeDateString';
import {
  TripDetails,
  TripDates,
  ParticipantInput,
  ItineraryItemInput,
  KnownInfoInput,
  buildTripDescription,
  computeTripDays,
  normalizeEmail,
  validateParticipants,
  validateTripDates,
  validateTripDetails,
} from '../utils/createTripWizard';

type Suggestion = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string | null;
  source?: 'user' | 'fellow';
};

type CreateTripWizardProps = {
  backendUrl: string;
  userToken: string | null;
  headers: Record<string, string>;
  traits: Trait[];
  styles: Record<string, any>;
  onCancel: () => void;
  onTripCreated: (tripId: string) => void;
};

const steps = [
  'Trip Details',
  'Dates',
  'Participants',
  'Itinerary',
  'Known Info',
  'Review & Confirm',
];

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

const CreateTripWizard: React.FC<CreateTripWizardProps> = ({
  backendUrl,
  userToken,
  headers,
  traits,
  styles,
  onCancel,
  onTripCreated,
}) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [details, setDetails] = useState<TripDetails>({ name: '', description: '', destination: '' });
  const [dates, setDates] = useState<TripDates>({
    startDate: '',
    endDate: '',
    startMonth: '',
    startYear: '',
    durationDays: '',
    mode: 'range',
  });
  const [participants, setParticipants] = useState<ParticipantInput[]>([]);
  const [participantDraft, setParticipantDraft] = useState<ParticipantInput>({ firstName: '', lastName: '', email: '' });
  const [participantSearch, setParticipantSearch] = useState('');
  const [participantSuggestions, setParticipantSuggestions] = useState<Suggestion[]>([]);
  const [itineraryEnabled, setItineraryEnabled] = useState(false);
  const [itineraryItems, setItineraryItems] = useState<ItineraryItemInput[]>([]);
  const [itineraryDraft, setItineraryDraft] = useState<ItineraryItemInput>({ date: '', time: '', activity: '' });
  const [itineraryDays, setItineraryDays] = useState('');
  const [itineraryTripStyle, setItineraryTripStyle] = useState('');
  const [itineraryDepartureAirport, setItineraryDepartureAirport] = useState('');
  const [budgetLevel, setBudgetLevel] = useState<'cheap' | 'middle' | 'expensive'>('middle');
  const [generateItinerary, setGenerateItinerary] = useState(false);
  const [knownInfoEnabled, setKnownInfoEnabled] = useState(false);
  const [knownInfo, setKnownInfo] = useState<KnownInfoInput>({ flights: '', lodging: '', tours: '', cars: '' });
  const [wizardError, setWizardError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdTripId, setCreatedTripId] = useState<string | null>(null);
  const [dateField, setDateField] = useState<'start' | 'end' | 'itinerary' | null>(null);
  const [dateValue, setDateValue] = useState<Date>(new Date());
  const startDateRef = useRef<HTMLInputElement | null>(null);
  const endDateRef = useRef<HTMLInputElement | null>(null);
  const itineraryDateRef = useRef<HTMLInputElement | null>(null);

  const totalSteps = steps.length;
  const computedDays = useMemo(() => computeTripDays(dates.startDate, dates.endDate), [dates.startDate, dates.endDate]);
  const monthLabel = useMemo(
    () => formatMonthYear(Number(dates.startMonth), Number(dates.startYear)),
    [dates.startMonth, dates.startYear]
  );

  useEffect(() => {
    if (!userToken) return;
    const query = participantSearch.trim();
    if (!query) {
      setParticipantSuggestions([]);
      return;
    }
    const handle = setTimeout(async () => {
      const res = await fetch(`${backendUrl}/api/trips/participants/search?q=${encodeURIComponent(query)}`, { headers });
      if (!res.ok) {
        setParticipantSuggestions([]);
        return;
      }
      const data = await res.json().catch(() => []);
      setParticipantSuggestions(Array.isArray(data) ? data : []);
    }, 300);
    return () => clearTimeout(handle);
  }, [backendUrl, headers, participantSearch, userToken]);

  const budgetRange = useMemo(() => {
    if (budgetLevel === 'cheap') return { min: 500, max: 1500 };
    if (budgetLevel === 'expensive') return { min: 4000, max: 8000 };
    return { min: 1500, max: 4000 };
  }, [budgetLevel]);

  const addParticipant = (entry: ParticipantInput) => {
    const normalized = {
      firstName: entry.firstName.trim(),
      lastName: entry.lastName.trim(),
      email: normalizeEmail(entry.email),
    };
    if (!normalized.firstName || !normalized.lastName) {
      setWizardError('Each participant needs a first and last name.');
      return;
    }
    if (normalized.email && participants.some((p) => normalizeEmail(p.email) === normalized.email)) {
      setWizardError('Participant emails must be unique.');
      return;
    }
    setParticipants((prev) => [...prev, normalized]);
    setParticipantDraft({ firstName: '', lastName: '', email: '' });
    setWizardError('');
  };

  const addItineraryItem = () => {
    if (!itineraryDraft.activity.trim()) {
      setWizardError('Add an activity description for the itinerary item.');
      return;
    }
    setItineraryItems((prev) => [...prev, { ...itineraryDraft, activity: itineraryDraft.activity.trim() }]);
    setItineraryDraft({ date: '', time: '', activity: '' });
    setWizardError('');
  };

  const openDatePicker = (field: 'start' | 'end' | 'itinerary') => {
    if (Platform.OS !== 'web' && NativeDateTimePicker) {
      const base =
        field === 'start'
          ? dates.startDate
          : field === 'end'
            ? dates.endDate
            : itineraryDraft.date;
      const date = base ? new Date(base) : new Date();
      setDateValue(date);
      setDateField(field);
      return;
    }
    const ref = field === 'start' ? startDateRef.current : field === 'end' ? endDateRef.current : itineraryDateRef.current;
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

  const canMoveNext = () => {
    if (stepIndex === 0) return !validateTripDetails(details);
    if (stepIndex === 1) return !validateTripDates(dates);
    if (stepIndex === 2) return !validateParticipants(participants);
    return true;
  };

  const goNext = () => {
    let error: string | null = null;
    if (stepIndex === 0) error = validateTripDetails(details);
    if (stepIndex === 1) error = validateTripDates(dates);
    if (stepIndex === 2) error = validateParticipants(participants);
    if (error) {
      setWizardError(error);
      return;
    }
    setWizardError('');
    setStepIndex((prev) => Math.min(prev + 1, totalSteps - 1));
  };

  const goBack = () => {
    setWizardError('');
    setStepIndex((prev) => Math.max(prev - 1, 0));
  };

  const insertDescriptionSnippet = (snippet: string) => {
    setDetails((prev) => ({
      ...prev,
      description: `${prev.description}${prev.description ? ' ' : ''}${snippet}`,
    }));
  };

  const submitWizard = async () => {
    if (!userToken) return;
    const detailError = validateTripDetails(details);
    const dateError = validateTripDates(dates);
    const participantError = validateParticipants(participants);
    if (detailError || dateError || participantError) {
      setWizardError(detailError || dateError || participantError || '');
      return;
    }
    setIsSubmitting(true);
    setWizardError('');
    const description = buildTripDescription(details, knownInfoEnabled ? knownInfo : undefined);
    try {
      const res = await fetch(`${backendUrl}/api/trips/wizard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          name: details.name.trim(),
          description: description.trim() || undefined,
          destination: details.destination.trim() || undefined,
          startDate: dates.mode === 'range' ? dates.startDate || undefined : undefined,
          endDate: dates.mode === 'range' ? dates.endDate || undefined : undefined,
          startMonth: dates.mode === 'month' ? Number(dates.startMonth) || undefined : undefined,
          startYear: dates.mode === 'month' ? Number(dates.startYear) || undefined : undefined,
          durationDays: dates.mode === 'month' ? Number(dates.durationDays) || undefined : undefined,
          participants,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWizardError(data.error || 'Unable to create trip');
        return;
      }

      const tripId = data.trip?.id as string | undefined;
      if (!tripId) {
        setWizardError('Trip created but no id was returned.');
        return;
      }

      if (itineraryEnabled && (itineraryItems.length || generateItinerary)) {
        const rangeDays = computeDurationFromRange(dates.startDate, dates.endDate);
        const days =
          (dates.mode === 'range' ? rangeDays : null) ??
          (Number(itineraryDays) > 0 ? Number(itineraryDays) : Number(dates.durationDays) || 1);
        const destination = details.destination.trim() || details.name.trim() || 'Trip';
        const createRes = await fetch(`${backendUrl}/api/itineraries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({
            tripId,
            destination,
            days,
            budget: budgetRange.max,
          }),
        });
        const created = await createRes.json().catch(() => ({}));
        const itineraryId = created.id ?? null;
        if (createRes.ok && itineraryId) {
          if (itineraryItems.length) {
            for (const item of itineraryItems) {
              let day = 1;
              if (dates.mode === 'range' && dates.startDate && item.date) {
                const start = new Date(dates.startDate);
                const itemDate = new Date(item.date);
                const diff = Math.floor((itemDate.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                if (Number.isFinite(diff) && diff > 0) day = diff;
              }
              await fetch(`${backendUrl}/api/itineraries/${itineraryId}/details`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({
                  day,
                  time: item.time || undefined,
                  activity: item.activity,
                  cost: null,
                }),
              });
            }
          }
          if (generateItinerary) {
            const aiRes = await fetch(`${backendUrl}/api/itinerary`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...headers },
              body: JSON.stringify({
                country: destination,
                days,
                budgetMin: budgetRange.min,
                budgetMax: budgetRange.max,
                departureAirport: itineraryDepartureAirport.trim() || undefined,
                tripStyle: itineraryTripStyle.trim() || undefined,
                tripId,
                traits: traits.map((t) => ({ name: t.name, level: t.level, notes: t.notes })),
              }),
            });
            const aiData = await aiRes.json().catch(() => ({}));
            if (aiRes.ok && aiData.plan) {
              const parsed = parsePlanToDetails(aiData.plan);
              for (const detail of parsed) {
                await fetch(`${backendUrl}/api/itineraries/${itineraryId}/details`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...headers },
                  body: JSON.stringify({
                    day: detail.day,
                    activity: detail.activity,
                    cost: detail.cost ?? null,
                  }),
                });
              }
            }
          }
        }
      }

      setCreatedTripId(tripId);
    } catch (err) {
      setWizardError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStepContent = () => {
    switch (stepIndex) {
      case 0:
        return (
          <>
            <Text style={styles.sectionTitle}>Trip Details</Text>
            <Text style={styles.helperText}>Name your trip and add a rich description.</Text>
            <TextInput
              style={styles.input}
              placeholder="Trip name"
              value={details.name}
              onChangeText={(text) => setDetails((prev) => ({ ...prev, name: text }))}
            />
            <TextInput
              style={styles.input}
              placeholder="Destination (optional, can include multiple locations)"
              value={details.destination}
              onChangeText={(text) => setDetails((prev) => ({ ...prev, destination: text }))}
            />
            <View style={styles.row}>
              <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => insertDescriptionSnippet('**Bold**')}>
                <Text style={styles.buttonText}>Bold</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => insertDescriptionSnippet('*Italic*')}>
                <Text style={styles.buttonText}>Italic</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => insertDescriptionSnippet('- List item')}>
                <Text style={styles.buttonText}>List</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => insertDescriptionSnippet('[Link](https://example.com)')}>
                <Text style={styles.buttonText}>Link</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.input, { minHeight: 120 }]}
              placeholder="Description (optional)"
              multiline
              value={details.description}
              onChangeText={(text) => setDetails((prev) => ({ ...prev, description: text }))}
            />
          </>
        );
      case 1:
        return (
          <>
            <Text style={styles.sectionTitle}>Dates</Text>
            <Text style={styles.helperText}>Choose exact dates or a month and duration (optional).</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.button, dates.mode === 'range' && styles.toggleActive, styles.smallButton]}
                onPress={() => setDates((prev) => ({ ...prev, mode: 'range' }))}
              >
                <Text style={styles.buttonText}>Start + End</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, dates.mode === 'month' && styles.toggleActive, styles.smallButton]}
                onPress={() => setDates((prev) => ({ ...prev, mode: 'month' }))}
              >
                <Text style={styles.buttonText}>Month + Days</Text>
              </TouchableOpacity>
            </View>
            {dates.mode === 'range' ? (
              <>
                <View style={styles.dateInputWrap}>
                  {Platform.OS === 'web' ? (
                    <input
                      ref={startDateRef as any}
                      type="date"
                      value={dates.startDate}
                      onChange={(e) => setDates((prev) => ({ ...prev, startDate: normalizeDateString(e.target.value) }))}
                      style={styles.input as any}
                    />
                  ) : (
                    <TouchableOpacity style={[styles.input, styles.dateTouchable]} onPress={() => openDatePicker('start')}>
                      <Text style={styles.cellText}>{dates.startDate || 'YYYY-MM-DD'}</Text>
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
                      value={dates.endDate}
                      onChange={(e) => setDates((prev) => ({ ...prev, endDate: normalizeDateString(e.target.value) }))}
                      style={styles.input as any}
                    />
                  ) : (
                    <TouchableOpacity style={[styles.input, styles.dateTouchable]} onPress={() => openDatePicker('end')}>
                      <Text style={styles.cellText}>{dates.endDate || 'YYYY-MM-DD'}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.dateIcon} onPress={() => openDatePicker('end')}>
                    <Text style={styles.selectCaret}>v</Text>
                  </TouchableOpacity>
                </View>
                {computedDays ? <Text style={styles.helperText}>Trip length: {computedDays} day(s)</Text> : null}
              </>
            ) : (
              <>
                <View style={styles.row}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Month (1-12)"
                    keyboardType="numeric"
                    value={dates.startMonth}
                    onChangeText={(text) => setDates((prev) => ({ ...prev, startMonth: text }))}
                  />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Year (YYYY)"
                    keyboardType="numeric"
                    value={dates.startYear}
                    onChangeText={(text) => setDates((prev) => ({ ...prev, startYear: text }))}
                  />
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="Number of days"
                  keyboardType="numeric"
                  value={dates.durationDays}
                  onChangeText={(text) => setDates((prev) => ({ ...prev, durationDays: text }))}
                />
                {monthLabel && dates.durationDays ? (
                  <Text style={styles.helperText}>
                    {monthLabel} · {dates.durationDays} day(s)
                  </Text>
                ) : null}
              </>
            )}
          </>
        );
      case 2:
        return (
          <>
            <Text style={styles.sectionTitle}>Participants</Text>
            <Text style={styles.helperText}>Add fellow travelers with first/last names and optional emails.</Text>
            <TextInput
              style={styles.input}
              placeholder="Search past travelers"
              value={participantSearch}
              onChangeText={setParticipantSearch}
            />
            {participantSuggestions.length ? (
              <View style={styles.dropdownList}>
                {participantSuggestions.map((suggestion) => (
                  <TouchableOpacity
                    key={`${suggestion.source}-${suggestion.id}`}
                    style={styles.dropdownOption}
                    onPress={() => {
                      addParticipant({
                        firstName: suggestion.firstName ?? '',
                        lastName: suggestion.lastName ?? '',
                        email: suggestion.email ?? '',
                      });
                      setParticipantSearch('');
                      setParticipantSuggestions([]);
                    }}
                  >
                    <Text style={styles.cellText}>
                      {`${suggestion.firstName ?? ''} ${suggestion.lastName ?? ''}`.trim() || suggestion.email || 'Traveler'}
                      {suggestion.email ? ` (${suggestion.email})` : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <View style={styles.row}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="First name"
                value={participantDraft.firstName}
                onChangeText={(text) => setParticipantDraft((prev) => ({ ...prev, firstName: text }))}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Last name"
                value={participantDraft.lastName}
                onChangeText={(text) => setParticipantDraft((prev) => ({ ...prev, lastName: text }))}
              />
            </View>
            <TextInput
              style={styles.input}
              placeholder="Email (optional)"
              autoCapitalize="none"
              keyboardType="email-address"
              value={participantDraft.email ?? ''}
              onChangeText={(text) => setParticipantDraft((prev) => ({ ...prev, email: text }))}
            />
            <TouchableOpacity style={styles.button} onPress={() => addParticipant(participantDraft)}>
              <Text style={styles.buttonText}>Add Participant</Text>
            </TouchableOpacity>
            {participants.length ? (
              <View style={{ marginTop: 12 }}>
                {participants.map((p, idx) => (
                  <View key={`${p.firstName}-${p.lastName}-${idx}`} style={styles.memberPill}>
                    <Text style={styles.cellText}>
                      {p.firstName} {p.lastName} {p.email ? `(${p.email})` : ''}
                    </Text>
                    <TouchableOpacity onPress={() => setParticipants((prev) => prev.filter((_, i) => i !== idx))}>
                      <Text style={styles.removeText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.helperText}>No additional participants yet.</Text>
            )}
          </>
        );
      case 3:
        return (
          <>
            <Text style={styles.sectionTitle}>Itinerary</Text>
            <Text style={styles.helperText}>Optionally create itinerary items now or generate a starter plan.</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.button, itineraryEnabled && styles.toggleActive]}
                onPress={() => setItineraryEnabled((prev) => !prev)}
              >
                <Text style={styles.buttonText}>{itineraryEnabled ? 'Itinerary On' : 'Add Itinerary'}</Text>
              </TouchableOpacity>
            </View>
            {itineraryEnabled ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Trip days (optional if dates are set)"
                  keyboardType="numeric"
                  value={itineraryDays}
                  onChangeText={setItineraryDays}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Trip style (optional)"
                  value={itineraryTripStyle}
                  onChangeText={setItineraryTripStyle}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Departure airport (optional)"
                  value={itineraryDepartureAirport}
                  onChangeText={setItineraryDepartureAirport}
                />
                <View style={styles.row}>
                  {(['cheap', 'middle', 'expensive'] as const).map((level) => (
                    <TouchableOpacity
                      key={level}
                      style={[styles.button, budgetLevel === level && styles.toggleActive, styles.smallButton]}
                      onPress={() => setBudgetLevel(level)}
                    >
                      <Text style={styles.buttonText}>{level}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.row}>
                  <TouchableOpacity
                    style={[styles.button, generateItinerary && styles.toggleActive]}
                    onPress={() => setGenerateItinerary((prev) => !prev)}
                  >
                    <Text style={styles.buttonText}>{generateItinerary ? 'AI Plan On' : 'Generate AI Plan'}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.headerText}>Manual itinerary items</Text>
                <View style={styles.dateInputWrap}>
                  {Platform.OS === 'web' ? (
                    <input
                      ref={itineraryDateRef as any}
                      type="date"
                      value={itineraryDraft.date}
                      onChange={(e) =>
                        setItineraryDraft((prev) => ({ ...prev, date: normalizeDateString(e.target.value) }))
                      }
                      style={styles.input as any}
                    />
                  ) : (
                    <TouchableOpacity style={[styles.input, styles.dateTouchable]} onPress={() => openDatePicker('itinerary')}>
                      <Text style={styles.cellText}>{itineraryDraft.date || 'YYYY-MM-DD'}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.dateIcon} onPress={() => openDatePicker('itinerary')}>
                    <Text style={styles.selectCaret}>v</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="Time (optional)"
                  value={itineraryDraft.time}
                  onChangeText={(text) => setItineraryDraft((prev) => ({ ...prev, time: text }))}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Activity description"
                  value={itineraryDraft.activity}
                  onChangeText={(text) => setItineraryDraft((prev) => ({ ...prev, activity: text }))}
                />
                <TouchableOpacity style={styles.button} onPress={addItineraryItem}>
                  <Text style={styles.buttonText}>Add Itinerary Item</Text>
                </TouchableOpacity>
                {itineraryItems.length ? (
                  <View style={{ marginTop: 12 }}>
                    {itineraryItems.map((item, idx) => (
                      <View key={`${item.activity}-${idx}`} style={styles.memberPill}>
                        <Text style={styles.cellText}>
                          {item.date || 'Day'} {item.time ? `@ ${item.time}` : ''} - {item.activity}
                        </Text>
                        <TouchableOpacity onPress={() => setItineraryItems((prev) => prev.filter((_, i) => i !== idx))}>
                          <Text style={styles.removeText}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.helperText}>No itinerary items yet.</Text>
                )}
              </>
            ) : (
              <Text style={styles.helperText}>You can always build an itinerary later.</Text>
            )}
          </>
        );
      case 4:
        return (
          <>
            <Text style={styles.sectionTitle}>Known Info</Text>
            <Text style={styles.helperText}>Add any known details. You can edit these later.</Text>
            <TouchableOpacity
              style={[styles.button, knownInfoEnabled && styles.toggleActive]}
              onPress={() => setKnownInfoEnabled((prev) => !prev)}
            >
              <Text style={styles.buttonText}>{knownInfoEnabled ? 'Notes On' : 'Add Notes'}</Text>
            </TouchableOpacity>
            {knownInfoEnabled ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Flight details"
                  value={knownInfo.flights}
                  onChangeText={(text) => setKnownInfo((prev) => ({ ...prev, flights: text }))}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Accommodation details"
                  value={knownInfo.lodging}
                  onChangeText={(text) => setKnownInfo((prev) => ({ ...prev, lodging: text }))}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Tours & activities"
                  value={knownInfo.tours}
                  onChangeText={(text) => setKnownInfo((prev) => ({ ...prev, tours: text }))}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Rental cars"
                  value={knownInfo.cars}
                  onChangeText={(text) => setKnownInfo((prev) => ({ ...prev, cars: text }))}
                />
              </>
            ) : (
              <Text style={styles.helperText}>Skip for now if you are not ready.</Text>
            )}
          </>
        );
      case 5:
      default:
        return (
          <>
            <Text style={styles.sectionTitle}>Review & Confirm</Text>
            <Text style={styles.helperText}>Confirm everything looks good before creating the trip.</Text>
            <Text style={styles.headerText}>Trip</Text>
            <Text style={styles.bodyText}>Name: {details.name || 'Untitled trip'}</Text>
            {details.destination ? <Text style={styles.bodyText}>Destination: {details.destination}</Text> : null}
            {dates.mode === 'range' && (dates.startDate || dates.endDate) ? (
              <Text style={styles.bodyText}>Dates: {dates.startDate || 'TBD'} - {dates.endDate || 'TBD'}</Text>
            ) : null}
            {dates.mode === 'month' && monthLabel && dates.durationDays ? (
              <Text style={styles.bodyText}>
                Dates: {monthLabel} · {dates.durationDays} day(s)
              </Text>
            ) : null}
            {details.description ? (
              <View style={{ marginTop: 8 }}>
                {renderRichTextBlocks(details.description, {
                  base: styles.bodyText,
                  bold: styles.headerText,
                  italic: styles.helperText,
                  link: styles.linkText ?? styles.buttonText,
                  listItem: styles.helperText,
                })}
              </View>
            ) : null}
            <Text style={styles.headerText}>Participants</Text>
            {participants.length ? (
              participants.map((p, idx) => (
                <Text key={`${p.firstName}-${p.lastName}-${idx}`} style={styles.bodyText}>
                  {p.firstName} {p.lastName} {p.email ? `(${p.email})` : ''}
                </Text>
              ))
            ) : (
              <Text style={styles.helperText}>No additional participants added.</Text>
            )}
            <Text style={styles.headerText}>Itinerary</Text>
            {itineraryEnabled ? (
              <Text style={styles.bodyText}>
                {generateItinerary ? 'AI plan will be generated.' : 'Manual items added.'} Items: {itineraryItems.length}
              </Text>
            ) : (
              <Text style={styles.helperText}>No itinerary created yet.</Text>
            )}
            {knownInfoEnabled ? (
              <>
                <Text style={styles.headerText}>Known Info</Text>
                {knownInfo.flights ? <Text style={styles.bodyText}>Flights: {knownInfo.flights}</Text> : null}
                {knownInfo.lodging ? <Text style={styles.bodyText}>Accommodation: {knownInfo.lodging}</Text> : null}
                {knownInfo.tours ? <Text style={styles.bodyText}>Tours & Activities: {knownInfo.tours}</Text> : null}
                {knownInfo.cars ? <Text style={styles.bodyText}>Rental cars: {knownInfo.cars}</Text> : null}
              </>
            ) : null}
          </>
        );
    }
  };

  if (createdTripId) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Trip created!</Text>
        <Text style={styles.helperText}>Your trip is ready. You can view it now.</Text>
        <TouchableOpacity style={styles.button} onPress={() => onTripCreated(createdTripId)}>
          <Text style={styles.buttonText}>View Trip</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={onCancel}>
          <Text style={styles.buttonText}>Back to Trips</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.card} contentContainerStyle={{ gap: 12 }}>
      <View>
        <Text style={styles.sectionTitle}>Create Trip Wizard</Text>
        <Text style={styles.helperText}>
          Step {stepIndex + 1} of {totalSteps}: {steps[stepIndex]}
        </Text>
      </View>
      {wizardError ? <Text style={styles.errorText}>{wizardError}</Text> : null}
      {renderStepContent()}
      <View style={styles.row}>
        <TouchableOpacity style={[styles.button, styles.dangerButton, { flex: 1 }]} onPress={stepIndex === 0 ? onCancel : goBack}>
          <Text style={styles.buttonText}>{stepIndex === 0 ? 'Cancel' : 'Back'}</Text>
        </TouchableOpacity>
        {stepIndex < totalSteps - 1 ? (
          <TouchableOpacity
            style={[styles.button, { flex: 1 }, !canMoveNext() && { opacity: 0.6 }]}
            onPress={goNext}
            disabled={!canMoveNext()}
          >
            <Text style={styles.buttonText}>Next</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={submitWizard} disabled={isSubmitting}>
            <Text style={styles.buttonText}>{isSubmitting ? 'Creating...' : 'Create Trip'}</Text>
          </TouchableOpacity>
        )}
      </View>
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
              setDates((prev) => ({ ...prev, startDate: iso }));
            } else if (dateField === 'end') {
              setDates((prev) => ({ ...prev, endDate: iso }));
            } else {
              setItineraryDraft((prev) => ({ ...prev, date: iso }));
            }
            setDateField(null);
          }}
        />
      ) : null}
    </ScrollView>
  );
};

export default CreateTripWizard;
