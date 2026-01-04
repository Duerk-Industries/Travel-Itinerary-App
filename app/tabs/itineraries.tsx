
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { formatDateLong } from '../utils/formatDateLong';
import type { Trait } from './traits';

type Styles = ReturnType<typeof StyleSheet.create>;
type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

interface ItineraryRecord {
  id: string;
  tripId: string;
  tripName: string;
  destination: string;
  days: number;
  budget?: number | null;
  createdAt: string;
}

interface ItineraryDetailRecord {
  id: string;
  itineraryId: string;
  day: number;
  time?: string | null;
  activity: string;
  cost?: number | null;
}

interface ItinerariesTabProps {
  backendUrl: string;
  userToken: string | null;
  activeTripId: string | null;
  traits: Trait[];
  headers: Record<string, string>;
  setActiveTripId: Setter<string | null>;
  styles: Styles;
}
const countryOptions = [
  'Afghanistan',
  'Albania',
  'Algeria',
  'Andorra',
  'Angola',
  'Antigua and Barbuda',
  'Argentina',
  'Armenia',
  'Australia',
  'Austria',
  'Azerbaijan',
  'Bahamas',
  'Bahrain',
  'Bangladesh',
  'Barbados',
  'Belarus',
  'Belgium',
  'Belize',
  'Benin',
  'Bhutan',
  'Bolivia',
  'Bosnia and Herzegovina',
  'Botswana',
  'Brazil',
  'Brunei',
  'Bulgaria',
  'Burkina Faso',
  'Burundi',
  'Cabo Verde',
  'Cambodia',
  'Cameroon',
  'Canada',
  'Central African Republic',
  'Chad',
  'Chile',
  'China',
  'Colombia',
  'Comoros',
  'Congo',
  'Costa Rica',
  'Cote d Ivoire',
  'Croatia',
  'Cuba',
  'Cyprus',
  'Czechia',
  'Democratic Republic of the Congo',
  'Denmark',
  'Djibouti',
  'Dominica',
  'Dominican Republic',
  'Ecuador',
  'Egypt',
  'El Salvador',
  'Equatorial Guinea',
  'Eritrea',
  'Estonia',
  'Eswatini',
  'Ethiopia',
  'Fiji',
  'Finland',
  'France',
  'Gabon',
  'Gambia',
  'Georgia',
  'Germany',
  'Ghana',
  'Greece',
  'Grenada',
  'Guatemala',
  'Guinea',
  'Guinea-Bissau',
  'Guyana',
  'Haiti',
  'Honduras',
  'Hungary',
  'Iceland',
  'India',
  'Indonesia',
  'Iran',
  'Iraq',
  'Ireland',
  'Israel',
  'Italy',
  'Jamaica',
  'Japan',
  'Jordan',
  'Kazakhstan',
  'Kenya',
  'Kiribati',
  'Kuwait',
  'Kyrgyzstan',
  'Laos',
  'Latvia',
  'Lebanon',
  'Lesotho',
  'Liberia',
  'Libya',
  'Liechtenstein',
  'Lithuania',
  'Luxembourg',
  'Madagascar',
  'Malawi',
  'Malaysia',
  'Maldives',
  'Mali',
  'Malta',
  'Marshall Islands',
  'Mauritania',
  'Mauritius',
  'Mexico',
  'Micronesia',
  'Moldova',
  'Monaco',
  'Mongolia',
  'Montenegro',
  'Morocco',
  'Mozambique',
  'Myanmar',
  'Namibia',
  'Nauru',
  'Nepal',
  'Netherlands',
  'New Zealand',
  'Nicaragua',
  'Niger',
  'Nigeria',
  'North Korea',
  'North Macedonia',
  'Norway',
  'Oman',
  'Pakistan',
  'Palau',
  'Panama',
  'Papua New Guinea',
  'Paraguay',
  'Peru',
  'Philippines',
  'Poland',
  'Portugal',
  'Qatar',
  'Romania',
  'Russia',
  'Rwanda',
  'Saint Kitts and Nevis',
  'Saint Lucia',
  'Saint Vincent and the Grenadines',
  'Samoa',
  'San Marino',
  'Sao Tome and Principe',
  'Saudi Arabia',
  'Senegal',
  'Serbia',
  'Seychelles',
  'Sierra Leone',
  'Singapore',
  'Slovakia',
  'Slovenia',
  'Solomon Islands',
  'Somalia',
  'South Africa',
  'South Korea',
  'South Sudan',
  'Spain',
  'Sri Lanka',
  'Sudan',
  'Suriname',
  'Sweden',
  'Switzerland',
  'Syria',
  'Taiwan',
  'Tajikistan',
  'Tanzania',
  'Thailand',
  'Timor-Leste',
  'Togo',
  'Tonga',
  'Trinidad and Tobago',
  'Tunisia',
  'Turkey',
  'Turkmenistan',
  'Tuvalu',
  'Uganda',
  'Ukraine',
  'United Arab Emirates',
  'United Kingdom',
  'United States',
  'Uruguay',
  'Uzbekistan',
  'Vanuatu',
  'Vatican City',
  'Venezuela',
  'Vietnam',
  'Yemen',
  'Zambia',
  'Zimbabwe',
];
const countryRegions: Record<string, string[]> = {
  'United States': [
    'Alabama',
    'Alaska',
    'Arizona',
    'Arkansas',
    'California',
    'Colorado',
    'Connecticut',
    'Delaware',
    'Florida',
    'Georgia',
    'Hawaii',
    'Idaho',
    'Illinois',
    'Indiana',
    'Iowa',
    'Kansas',
    'Kentucky',
    'Louisiana',
    'Maine',
    'Maryland',
    'Massachusetts',
    'Michigan',
    'Minnesota',
    'Mississippi',
    'Missouri',
    'Montana',
    'Nebraska',
    'Nevada',
    'New Hampshire',
    'New Jersey',
    'New Mexico',
    'New York',
    'North Carolina',
    'North Dakota',
    'Ohio',
    'Oklahoma',
    'Oregon',
    'Pennsylvania',
    'Rhode Island',
    'South Carolina',
    'South Dakota',
    'Tennessee',
    'Texas',
    'Utah',
    'Vermont',
    'Virginia',
    'Washington',
    'West Virginia',
    'Wisconsin',
    'Wyoming',
  ],
  Canada: [
    'Alberta',
    'British Columbia',
    'Manitoba',
    'New Brunswick',
    'Newfoundland and Labrador',
    'Northwest Territories',
    'Nova Scotia',
    'Nunavut',
    'Ontario',
    'Prince Edward Island',
    'Quebec',
    'Saskatchewan',
    'Yukon',
  ],
  Australia: ['Australian Capital Territory', 'New South Wales', 'Northern Territory', 'Queensland', 'South Australia', 'Tasmania', 'Victoria', 'Western Australia'],
  India: [
    'Andhra Pradesh',
    'Assam',
    'Bihar',
    'Chhattisgarh',
    'Delhi',
    'Goa',
    'Gujarat',
    'Haryana',
    'Himachal Pradesh',
    'Jammu and Kashmir',
    'Jharkhand',
    'Karnataka',
    'Kerala',
    'Madhya Pradesh',
    'Maharashtra',
    'Manipur',
    'Meghalaya',
    'Mizoram',
    'Nagaland',
    'Odisha',
    'Punjab',
    'Rajasthan',
    'Sikkim',
    'Tamil Nadu',
    'Telangana',
    'Tripura',
    'Uttar Pradesh',
    'Uttarakhand',
    'West Bengal',
  ],
  'United Kingdom': ['England', 'Northern Ireland', 'Scotland', 'Wales'],
};
const ItinerariesTab: React.FC<ItinerariesTabProps> = ({
  backendUrl,
  userToken,
  activeTripId,
  traits,
  headers,
  setActiveTripId,
  styles,
}) => {
  const [itineraryCountry, setItineraryCountry] = useState('');
  const [itineraryRegion, setItineraryRegion] = useState('');
  const [countrySearch, setCountrySearch] = useState('');
  const [regionSearch, setRegionSearch] = useState('');
  const [showItineraryCountryDropdown, setShowItineraryCountryDropdown] = useState(false);
  const [showItineraryRegionDropdown, setShowItineraryRegionDropdown] = useState(false);
  const [itineraryDays, setItineraryDays] = useState('5');
  const [budgetMin, setBudgetMin] = useState(500);
  const [budgetMax, setBudgetMax] = useState(2500);
  const [budgetLevel, setBudgetLevel] = useState<'cheap' | 'middle' | 'expensive'>('middle');
  const [itineraryAirport, setItineraryAirport] = useState('');
  const [itineraryAirportOptions, setItineraryAirportOptions] = useState<string[]>([]);
  const [showItineraryAirportDropdown, setShowItineraryAirportDropdown] = useState(false);
  const [itineraryPlan, setItineraryPlan] = useState('');
  const [itineraryTripStyle, setItineraryTripStyle] = useState('');
  const [itineraryLoading, setItineraryLoading] = useState(false);
  const [itineraryError, setItineraryError] = useState('');
  const [itineraryRecords, setItineraryRecords] = useState<ItineraryRecord[]>([]);
  const [itineraryDetails, setItineraryDetails] = useState<Record<string, ItineraryDetailRecord[]>>({});
  const [selectedItineraryId, setSelectedItineraryId] = useState<string | null>(null);
  const [editingItineraryId, setEditingItineraryId] = useState<string | null>(null);
  const [editingDetailId, setEditingDetailId] = useState<string | null>(null);
  const [detailDraft, setDetailDraft] = useState({ day: '1', time: '', activity: '', cost: '' });

  const filteredCountries = useMemo(() => {
    const query = (showItineraryCountryDropdown ? countrySearch : itineraryCountry).trim().toLowerCase();
    if (!query) return countryOptions;
    return countryOptions.filter((c) => c.toLowerCase().includes(query));
  }, [countrySearch, itineraryCountry, showItineraryCountryDropdown]);

  const regionOptions = useMemo(() => countryRegions[itineraryCountry] ?? [], [itineraryCountry]);

  const filteredRegions = useMemo(() => {
    if (!regionOptions.length) return [];
    const query = (showItineraryRegionDropdown ? regionSearch : itineraryRegion).trim().toLowerCase();
    if (!query) return regionOptions;
    return regionOptions.filter((r) => r.toLowerCase().includes(query));
  }, [itineraryRegion, regionOptions, regionSearch, showItineraryRegionDropdown]);

  const findExistingItinerary = (
    tripId: string,
    destination: string,
    days: number,
    excludeId?: string | null,
    budget?: number | null
  ) => {
    const dest = destination.trim().toLowerCase();
    const normalizedBudget = budget != null ? Number(budget) : null;
    return itineraryRecords.find(
      (i) =>
        i.id !== excludeId &&
        i.tripId === tripId &&
        i.destination.trim().toLowerCase() === dest &&
        i.days === days &&
        (i.budget ?? null) === (normalizedBudget ?? null)
    );
  };

  const fetchItineraries = async () => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/itineraries`, { headers });
    if (!res.ok) return;
    const data = await res.json();
    setItineraryRecords(data);
  };

  const fetchItineraryDetails = async (itineraryId: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/itineraries/${itineraryId}/details`, { headers });
    if (!res.ok) return;
    const data = await res.json();
    setItineraryDetails((prev) => ({ ...prev, [itineraryId]: dedupeDetails(data) }));
  };

  const beginEditItinerary = (it: ItineraryRecord) => {
    setEditingItineraryId(it.id);
    setSelectedItineraryId(it.id);
    setActiveTripId(it.tripId);
    setItineraryCountry(it.destination);
    setItineraryDays(String(it.days));
    if (it.budget != null) setBudgetMax(Number(it.budget));
    fetchItineraryDetails(it.id);
  };

  const dedupeDetails = (list: ItineraryDetailRecord[]) => {
    const seen = new Set<string>();
    return list.filter((d) => {
      const key = `${d.day}|${(d.activity || '').toLowerCase().trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const fetchItineraryAirports = async (q: string) => {
    if (!userToken || !q.trim()) {
      setItineraryAirportOptions([]);
      return;
    }
    const res = await fetch(`${backendUrl}/api/flights/locations?q=${encodeURIComponent(q.trim())}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (!res.ok) {
      setItineraryAirportOptions([]);
      return;
    }
    const data = await res.json();
    setItineraryAirportOptions(data);
    setShowItineraryAirportDropdown(true);
  };
  const parsePlanToDetails = (plan: string): Array<{ day: number; activity: string; cost?: number | null }> => {
    const details: Array<{ day: number; activity: string; cost?: number | null }> = [];
    let currentDay: number | null = null;

    for (const raw of plan.split('\n')) {
      const line = raw.trim();
      if (!line) continue;

      const dayMatch = line.match(/day\s*(\d+)/i);
      if (dayMatch) {
        currentDay = Number(dayMatch[1]);
        continue;
      }
      if (currentDay == null) continue;

      const activity = line.replace(/^[-*]\s*/, '').trim();
      if (!activity) continue;

      const costMatch = activity.match(/\$([\d.,]+)/);
      const cost = costMatch ? Number(costMatch[1].replace(/,/g, '')) : null;
      details.push({ day: currentDay, activity, cost: Number.isFinite(cost as number) ? (cost as number) : null });
    }

    return details;
  };

  const saveGeneratedItinerary = async (plan: string) => {
    if (!activeTripId) {
      setItineraryError('Select an active trip before saving the itinerary.');
      return;
    }
    const destination = itineraryCountry.trim() || 'Unknown';
    const daysNum = Number(itineraryDays || '1');
    const existing = findExistingItinerary(activeTripId, destination, daysNum, null, budgetMax);
    let itineraryId = existing?.id;
    if (!itineraryId) {
      const createRes = await fetch(`${backendUrl}/api/itineraries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          tripId: activeTripId,
          destination,
          days: daysNum,
          budget: budgetMax,
        }),
      });
      const created = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        const message = (created.error || '').toLowerCase();
        if (message.includes('already exists')) {
          const existingRecord = itineraryRecords.find((i) => i.tripId === activeTripId);
          itineraryId = existingRecord?.id;
        }
        if (!itineraryId) {
          setItineraryError(created.error || 'Unable to save itinerary');
          return;
        }
      } else {
        itineraryId = created.id as string;
        fetchItineraries();
      }
      setSelectedItineraryId(itineraryId);
    } else {
      setItineraryError('');
      setSelectedItineraryId(itineraryId);
    }

    const parsedDetails = parsePlanToDetails(plan);
    if (parsedDetails.length) {
      const uniqueKeys = new Set<string>();
      for (const d of parsedDetails) {
        const key = `${d.day}|${d.activity.toLowerCase().trim()}`;
        if (uniqueKeys.has(key)) continue;
        uniqueKeys.add(key);
        await fetch(`${backendUrl}/api/itineraries/${itineraryId}/details`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({
            day: d.day,
            activity: d.activity,
            cost: d.cost ?? null,
          }),
        }).catch(() => undefined);
      }
      fetchItineraryDetails(itineraryId);
    }
  };

  const generateItinerary = async () => {
    if (!userToken) return;
    const country = itineraryCountry.trim();
    const days = itineraryDays.trim();
    if (!country || !days || !activeTripId) {
      alert('Enter a country, number of days, and select an active trip.');
      return;
    }
    setShowItineraryCountryDropdown(false);
    setShowItineraryRegionDropdown(false);
    setItineraryLoading(true);
    setItineraryError('');
    setItineraryPlan('');
    try {
      const res = await fetch(`${backendUrl}/api/itinerary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          country,
          days: Number(days),
          budgetMin,
          budgetMax,
          departureAirport: itineraryAirport.trim() || undefined,
          tripStyle: itineraryTripStyle.trim() || undefined,
          tripId: activeTripId,
          traits: traits.map((t) => ({ name: t.name })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data.detail ? ` (${data.detail})` : '';
        setItineraryError((data.error || 'Failed to generate itinerary') + detail);
        return;
      }
      setItineraryPlan(data.plan || '');
      await saveGeneratedItinerary(data.plan || '');
    } catch (err) {
      setItineraryError((err as Error).message);
    } finally {
      setItineraryLoading(false);
    }
  };

  const saveItineraryRecord = async () => {
    if (!userToken) return;
    if (!activeTripId) {
      alert('Choose an active trip before saving an itinerary.');
      return;
    }
    if (!itineraryCountry.trim() || !itineraryDays.trim()) {
      alert('Enter destination and days first.');
      return;
    }
    const destination = itineraryCountry.trim();
    const daysNum = Number(itineraryDays);
    const existing = findExistingItinerary(activeTripId, destination, daysNum, editingItineraryId, budgetMax);
    if (existing) {
      alert('Itinerary already exists for this trip');
      return;
    }
    const method = editingItineraryId ? 'PUT' : 'POST';
    const url = editingItineraryId ? `${backendUrl}/api/itineraries/${editingItineraryId}` : `${backendUrl}/api/itineraries`;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        tripId: activeTripId,
        destination,
        days: daysNum,
        budget: budgetMax,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to save itinerary');
      return;
    }
    if (data.id) {
      setSelectedItineraryId(data.id);
      fetchItineraryDetails(data.id);
    }
    setEditingItineraryId(null);
    fetchItineraries();
  };

  const saveDetail = async () => {
    if (!userToken || !selectedItineraryId) {
      alert('Select an itinerary to add details');
      return;
    }
    if (!detailDraft.activity.trim()) {
      alert('Enter an activity');
      return;
    }
    const payload = {
      day: Number(detailDraft.day || '1'),
      time: detailDraft.time || null,
      activity: detailDraft.activity.trim(),
      cost: detailDraft.cost ? Number(detailDraft.cost) : null,
    };
    const url = editingDetailId
      ? `${backendUrl}/api/itineraries/details/${editingDetailId}`
      : `${backendUrl}/api/itineraries/${selectedItineraryId}/details`;
    const method = editingDetailId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to save detail');
      return;
    }
    setDetailDraft({ day: '1', time: '', activity: '', cost: '' });
    setEditingDetailId(null);
    fetchItineraryDetails(selectedItineraryId);
  };

  const deleteItinerary = async (itineraryId: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/itineraries/${itineraryId}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to delete itinerary');
      return;
    }
    setItineraryRecords((prev) => prev.filter((i) => i.id !== itineraryId));
    setItineraryDetails((prev) => {
      const next = { ...prev };
      delete next[itineraryId];
      return next;
    });
    if (selectedItineraryId === itineraryId) setSelectedItineraryId(null);
    if (editingItineraryId === itineraryId) setEditingItineraryId(null);
    setEditingDetailId(null);
  };

  useEffect(() => {
    if (!userToken) return;
    fetchItineraries();
  }, [userToken]);

  useEffect(() => {
    const presets: Record<typeof budgetLevel, { min: number; max: number }> = {
      cheap: { min: 500, max: 1500 },
      middle: { min: 1500, max: 4000 },
      expensive: { min: 4000, max: 8000 },
    };
    const preset = presets[budgetLevel];
    setBudgetMin(preset.min);
    setBudgetMax(preset.max);
  }, [budgetLevel]);

  useEffect(() => {
    setItineraryRegion('');
    setRegionSearch('');
    setShowItineraryRegionDropdown(false);
  }, [itineraryCountry]);
  return (
    <>
      <View style={[styles.card, styles.itinerarySection]}>
        <Text style={styles.sectionTitle}>Create Itinerary</Text>
        <Text style={styles.helperText}>Capture the basics and we'll use your traits to shape trip ideas.</Text>
        {itineraryError ? <Text style={styles.errorText}>{itineraryError}</Text> : null}

        <View>
          <TouchableOpacity
            style={[styles.input, styles.selectButton]}
            onPress={() => {
              setCountrySearch('');
              setShowItineraryCountryDropdown(true);
              setShowItineraryRegionDropdown(false);
            }}
          >
            <View style={styles.selectButtonRow}>
              <Text style={itineraryCountry ? styles.cellText : styles.placeholderText}>
                {itineraryCountry || 'Select a country'}
              </Text>
              <Text style={styles.selectCaret}>v</Text>
            </View>
          </TouchableOpacity>
          {regionOptions.length ? (
            <TouchableOpacity
              style={[styles.input, styles.selectButton]}
              onPress={() => {
                setRegionSearch('');
                setShowItineraryRegionDropdown(true);
                setShowItineraryCountryDropdown(false);
              }}
            >
              <View style={styles.selectButtonRow}>
                <Text style={itineraryRegion ? styles.cellText : styles.placeholderText}>
                  {itineraryRegion || 'Select a region / state'}
                </Text>
                <Text style={styles.selectCaret}>v</Text>
              </View>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.dropdown}>
          <TextInput
            style={styles.input}
            placeholder="Departure airport (e.g., JFK, LAX, CDG)"
            value={itineraryAirport}
            onFocus={() => fetchItineraryAirports(itineraryAirport)}
            onChangeText={(text) => {
              setItineraryAirport(text);
              fetchItineraryAirports(text);
            }}
          />
          {showItineraryAirportDropdown && itineraryAirportOptions.length ? (
            <View style={[styles.dropdownList, styles.itineraryDropdown]}>
              {itineraryAirportOptions.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={styles.dropdownOption}
                  onPress={() => {
                    setItineraryAirport(opt);
                    setShowItineraryAirportDropdown(false);
                  }}
                >
                  <Text style={styles.cellText}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>

        <TextInput
          style={styles.input}
          placeholder="How many days will your vacation be?"
          keyboardType="numeric"
          value={itineraryDays}
          onChangeText={(text) => setItineraryDays(text.replace(/[^0-9]/g, ''))}
        />
        <TextInput
          style={styles.input}
          placeholder="What kind of trip do you want? (e.g., foodie weekend, outdoor adventure, museum crawl)"
          value={itineraryTripStyle}
          onChangeText={setItineraryTripStyle}
          multiline
        />

        <Text style={styles.modalLabel}>Budget</Text>
        <View style={styles.addRow}>
          {(['cheap', 'middle', 'expensive'] as const).map((level) => (
            <TouchableOpacity
              key={level}
              style={[
                styles.button,
                styles.smallButton,
                budgetLevel === level && styles.toggleActive,
                { flex: 1 },
              ]}
              onPress={() => setBudgetLevel(level)}
            >
              <View style={styles.budgetRow}>
                <Text style={styles.buttonText}>
                  {level === 'cheap' ? 'Cheap' : level === 'middle' ? 'Middle' : 'Expensive'}
                </Text>
                <View style={[styles.budgetIndicator, budgetLevel === level && styles.budgetIndicatorActive]} />
              </View>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.helperText}>Cheap ~$500-$1,500 | Middle ~$1,500-$4,000 | Expensive ~$4,000-$8,000</Text>

        <TouchableOpacity style={styles.button} onPress={generateItinerary} disabled={itineraryLoading}>
          <Text style={styles.buttonText}>{itineraryLoading ? 'Generating...' : 'Generate Itinerary'}</Text>
        </TouchableOpacity>
        {itineraryPlan ? (
          <View style={styles.planBox}>
            <Text style={styles.sectionTitle}>Suggested Plan</Text>
            <Text style={styles.bodyText}>{itineraryPlan}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Saved Itineraries</Text>
        {!itineraryRecords.length ? (
          <Text style={styles.helperText}>No itineraries saved yet.</Text>
        ) : (
          itineraryRecords.map((it) => {
            const isSelected = selectedItineraryId === it.id;
            return (
              <TouchableOpacity
                key={it.id}
                style={[styles.row, { alignItems: 'center', paddingVertical: 6 }]}
                onPress={() => {
                  setEditingItineraryId(null);
                  setSelectedItineraryId(it.id);
                  if (!itineraryDetails[it.id]) {
                    fetchItineraryDetails(it.id);
                  }
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.flightTitle}>{it.tripName || 'Trip'}</Text>
                  <Text style={styles.helperText}>
                    {`${it.destination || 'Destination'} | ${it.days} days | Budget ${it.budget ?? 'N/A'} | Created ${formatDateLong(it.createdAt)}`}
                  </Text>
                </View>
                <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => beginEditItinerary(it)}>
                  <Text style={styles.buttonText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => deleteItinerary(it.id)}>
                  <Text style={styles.buttonText}>Delete</Text>
                </TouchableOpacity>
                <View style={[styles.button, isSelected && styles.toggleActive]}>
                  <Text style={styles.buttonText}>{isSelected ? 'Selected' : 'View'}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </View>

      {selectedItineraryId ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Itinerary Details</Text>
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeader]}>
              <View style={[styles.cell, { flex: 1 }]}>
                <Text style={styles.headerText}>Day</Text>
              </View>
              <View style={[styles.cell, { flex: 1 }]}>
                <Text style={styles.headerText}>Time</Text>
              </View>
              <View style={[styles.cell, { flex: 2 }]}>
                <Text style={styles.headerText}>Activity</Text>
              </View>
              <View style={[styles.cell, { flex: 1 }]}>
                <Text style={styles.headerText}>Cost</Text>
              </View>
              <View style={[styles.cell, styles.actionCell, { flex: 1 }]}>
                <Text style={styles.headerText}>Actions</Text>
              </View>
            </View>
            {(itineraryDetails[selectedItineraryId] ?? []).map((d) => (
              <View key={d.id} style={styles.tableRow}>
                <View style={[styles.cell, { flex: 1 }]}>
                  <Text style={styles.cellText}>{d.day}</Text>
                </View>
                <View style={[styles.cell, { flex: 1 }]}>
                  <Text style={styles.cellText}>{d.time || '-'}</Text>
                </View>
                <View style={[styles.cell, { flex: 2 }]}>
                  <Text style={styles.cellText}>{d.activity}</Text>
                </View>
                <View style={[styles.cell, { flex: 1 }]}>
                  <Text style={styles.cellText}>{d.cost != null ? `$${d.cost}` : '-'}</Text>
                </View>
                <View style={[styles.cell, styles.actionCell, { flex: 1 }]}>
                  <TouchableOpacity
                    style={[styles.button, styles.smallButton]}
                    onPress={() => {
                      setEditingDetailId(d.id);
                      setDetailDraft({
                        day: String(d.day ?? '1'),
                        time: d.time ?? '',
                        activity: d.activity ?? '',
                        cost: d.cost != null ? String(d.cost) : '',
                      });
                    }}
                  >
                    <Text style={styles.buttonText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.button, styles.smallButton, styles.dangerButton]}
                    onPress={async () => {
                      await fetch(`${backendUrl}/api/itineraries/details/${d.id}`, {
                        method: 'DELETE',
                        headers,
                      });
                      if (editingDetailId === d.id) setEditingDetailId(null);
                      fetchItineraryDetails(selectedItineraryId);
                    }}
                  >
                    <Text style={styles.buttonText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            <View style={[styles.tableRow, styles.inputRow]}>
              <View style={[styles.cell, { flex: 1 }]}>
                <TextInput
                  style={styles.input}
                  placeholder="Day"
                  keyboardType="numeric"
                  value={detailDraft.day}
                  onChangeText={(text) => setDetailDraft((prev) => ({ ...prev, day: text }))}
                />
              </View>
              <View style={[styles.cell, { flex: 1 }]}>
                <TextInput
                  style={styles.input}
                  placeholder="Time"
                  value={detailDraft.time}
                  onChangeText={(text) => setDetailDraft((prev) => ({ ...prev, time: text }))}
                />
              </View>
              <View style={[styles.cell, { flex: 2 }]}>
                <TextInput
                  style={styles.input}
                  placeholder="Activity"
                  value={detailDraft.activity}
                  onChangeText={(text) => setDetailDraft((prev) => ({ ...prev, activity: text }))}
                />
              </View>
              <View style={[styles.cell, { flex: 1 }]}>
                <TextInput
                  style={styles.input}
                  placeholder="Cost"
                  keyboardType="numeric"
                  value={detailDraft.cost}
                  onChangeText={(text) => setDetailDraft((prev) => ({ ...prev, cost: text }))}
                />
              </View>
              <View style={[styles.cell, styles.actionCell, { flex: 1 }]}>
                <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={saveDetail}>
                  <Text style={styles.buttonText}>{editingDetailId ? 'Update' : 'Add'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      ) : null}

      {showItineraryCountryDropdown ? (
        <View style={styles.dropdownOverlay}>
          <TouchableOpacity
            style={styles.dropdownBackdrop}
            onPress={() => setShowItineraryCountryDropdown(false)}
          />
          <View style={styles.dropdownPortal}>
            <TextInput
              style={[styles.input, styles.inlineInput]}
              placeholder="Search countries"
              value={countrySearch}
              onChangeText={setCountrySearch}
              autoFocus
            />
            <ScrollView style={styles.dropdownScroll}>
              {filteredCountries.map((name) => (
                <TouchableOpacity
                  key={name}
                  style={styles.dropdownOption}
                  onPress={() => {
                    setItineraryCountry(name);
                    setItineraryRegion('');
                    setCountrySearch('');
                    setRegionSearch('');
                    setShowItineraryCountryDropdown(false);
                    setShowItineraryRegionDropdown(false);
                  }}
                >
                  <Text style={styles.cellText}>{name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      ) : null}
      {showItineraryRegionDropdown && regionOptions.length ? (
        <View style={styles.dropdownOverlay}>
          <TouchableOpacity
            style={styles.dropdownBackdrop}
            onPress={() => setShowItineraryRegionDropdown(false)}
          />
          <View style={styles.dropdownPortal}>
            <TextInput
              style={[styles.input, styles.inlineInput]}
              placeholder="Search regions / states"
              value={regionSearch}
              onChangeText={setRegionSearch}
              autoFocus
            />
            <ScrollView style={styles.dropdownScroll}>
              {filteredRegions.map((name) => (
                <TouchableOpacity
                  key={name}
                  style={styles.dropdownOption}
                  onPress={() => {
                    setItineraryRegion(name);
                    setRegionSearch('');
                    setShowItineraryRegionDropdown(false);
                  }}
                >
                  <Text style={styles.cellText}>{name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      ) : null}
    </>
  );
};

export default ItinerariesTab;
