import React, { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { formatDateLong } from '../utils/formatDateLong';

export type Tour = {
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
  paidBy: string[];
};

export type TourDraft = {
  date: string;
  name: string;
  startLocation: string;
  startTime: string;
  duration: string;
  cost: string;
  freeCancelBy: string;
  bookedOn: string;
  reference: string;
  paidBy: string[];
};

export type GroupMemberOption = {
  id: string;
  guestName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
};

// Build a blank tour draft with today's date and zero cost.
export const createInitialTourState = (): TourDraft => ({
  date: new Date().toISOString().slice(0, 10),
  name: '',
  startLocation: '',
  startTime: '',
  duration: '',
  cost: '0',
  freeCancelBy: new Date().toISOString().slice(0, 10),
  bookedOn: '',
  reference: '',
  paidBy: [],
});

export const buildTourPayload = (draft: TourDraft, defaultPayerId?: string | null): { payload?: TourDraft; error?: string } => {
  if (!draft.name.trim()) return { error: 'Please enter a tour name.' };
  const cleanCost = (draft.cost || '').replace(/[^0-9.]/g, '');
  let payload: TourDraft = { ...draft, cost: cleanCost };
  if ((!payload.paidBy || payload.paidBy.length === 0) && defaultPayerId) {
    payload = { ...payload, paidBy: [defaultPayerId] };
  }
  return { payload };
};

export const createTourForTrip = async (params: {
  backendUrl: string;
  jsonHeaders: Record<string, string>;
  draft: TourDraft;
  activeTripId: string | null;
  defaultPayerId?: string | null;
}): Promise<{ ok: boolean; error?: string }> => {
  const { backendUrl, jsonHeaders, draft, activeTripId, defaultPayerId } = params;
  if (!activeTripId) return { ok: false, error: 'Select an active trip before saving a tour.' };
  const { payload, error } = buildTourPayload(draft, defaultPayerId);
  if (error || !payload) return { ok: false, error };
  const res = await fetch(`${backendUrl}/api/tours`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      ...payload,
      tripId: activeTripId,
      freeCancelBy: payload.freeCancelBy?.trim() || null,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || 'Unable to save tour' };
  return { ok: true };
};

export const fetchToursForTrip = async ({
  backendUrl,
  activeTripId,
  token,
}: {
  backendUrl: string;
  activeTripId: string | null;
  token?: string | null;
}): Promise<Tour[]> => {
  if (!activeTripId || !token) return [];
  const res = await fetch(`${backendUrl}/api/tours?tripId=${activeTripId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data as any[]).map((t) => ({
    ...t,
    cost: String(t.cost ?? ''),
    paidBy: Array.isArray(t.paidBy) ? t.paidBy : [],
    bookedOn: t.bookedOn ?? '',
    freeCancelBy: t.freeCancelBy ?? '',
  }));
};

type NativeDateTimePickerType = typeof import('@react-native-community/datetimepicker').default;

type TourTabProps = {
  backendUrl: string;
  userToken: string | null;
  activeTripId: string | null;
  tours: Tour[];
  setTours: React.Dispatch<React.SetStateAction<Tour[]>>;
  defaultPayerId: string | null;
  payerName: (id: string) => string;
  formatMemberName: (member: GroupMemberOption) => string;
  userMembers: GroupMemberOption[];
  jsonHeaders: Record<string, string>;
  payerTotals: Record<string, number>;
  toursTotal: number;
  styles: ReturnType<typeof StyleSheet.create>;
  nativeDateTimePicker: NativeDateTimePickerType | null;
  fetchTours: (token?: string) => Promise<void>;
};

export const TourTab: React.FC<TourTabProps> = ({
  backendUrl,
  userToken,
  activeTripId,
  tours,
  setTours,
  defaultPayerId,
  payerName,
  formatMemberName,
  userMembers,
  jsonHeaders,
  payerTotals,
  toursTotal,
  styles,
  nativeDateTimePicker,
  fetchTours,
}) => {
  const [editingTour, setEditingTour] = useState<TourDraft | null>(null);
  const [editingTourId, setEditingTourId] = useState<string | null>(null);
  const [tourDateField, setTourDateField] = useState<'date' | 'bookedOn' | 'freeCancel' | 'startTime' | null>(null);
  const [tourDateValue, setTourDateValue] = useState<Date>(new Date());
  const DateTimePickerComponent = nativeDateTimePicker;

  const openTourEditor = (tour?: Tour) => {
    if (!activeTripId) {
      alert('Select an active trip before adding a tour.');
      return;
    }
    const base = tour ? { ...tour } : createInitialTourState();
    if (!tour && defaultPayerId && !base.paidBy.includes(defaultPayerId)) {
      base.paidBy = [...base.paidBy, defaultPayerId];
    }
    setEditingTour(base);
    setEditingTourId(tour?.id ?? null);
    const baseDate = tour?.date ?? new Date().toISOString().slice(0, 10);
    setTourDateValue(baseDate ? new Date(baseDate) : new Date());
  };

  const closeTourEditor = () => {
    setEditingTour(null);
    setEditingTourId(null);
    setTourDateField(null);
  };

  const openTourDatePicker = (field: 'date' | 'bookedOn' | 'freeCancel' | 'startTime') => {
    setTourDateField(field);
    if (!editingTour) return;
    const current =
      field === 'date'
        ? editingTour.date
        : field === 'bookedOn'
          ? editingTour.bookedOn
          : field === 'freeCancel'
            ? editingTour.freeCancelBy
            : editingTour.startTime;
    if (field === 'startTime') {
      const base = new Date();
      if (current && /^\d{1,2}:\d{2}/.test(current)) {
        const [h, m] = current.split(':').map(Number);
        if (!Number.isNaN(h) && !Number.isNaN(m)) {
          base.setHours(h, m, 0, 0);
        }
      }
      setTourDateValue(base);
    } else {
      setTourDateValue(current ? new Date(current) : new Date());
    }
  };

  const saveTour = () => {
    if (!editingTour) return;
    if (!editingTour.name.trim()) {
      alert('Please enter a tour name.');
      return;
    }
    const cleanCost = (editingTour.cost || '').replace(/[^0-9.]/g, '');
    let payload: TourDraft = { ...editingTour, cost: cleanCost };
    if ((!payload.paidBy || payload.paidBy.length === 0) && defaultPayerId) {
      payload = { ...payload, paidBy: [defaultPayerId] };
    }
    if (!activeTripId) {
      alert('Select an active trip before saving a tour.');
      return;
    }
    const method = editingTourId ? 'PUT' : 'POST';
    const url = editingTourId ? `${backendUrl}/api/tours/${editingTourId}` : `${backendUrl}/api/tours`;
    (async () => {
      try {
        const res = await fetch(url, {
          method,
          headers: jsonHeaders,
          body: JSON.stringify({
            ...payload,
            tripId: activeTripId,
            freeCancelBy: payload.freeCancelBy?.trim() || null,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Unable to save tour (status ${res.status})`);
        }
        await fetchTours();
        closeTourEditor();
      } catch (err: any) {
        console.error('saveTour failed', err);
        alert(err.message || 'Unable to save tour');
      }
    })();
  };

  const removeTour = (id: string) => {
    fetch(`${backendUrl}/api/tours/${id}`, { method: 'DELETE', headers: jsonHeaders })
      .then((res) => {
        if (!res.ok) throw new Error('Unable to delete tour');
        fetchTours();
      })
      .catch((err) => alert(err.message));
  };

  const payerTotalsList = useMemo(() => Object.entries(payerTotals), [payerTotals]);

  return (
    <View style={styles.card}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Tours</Text>
        <TouchableOpacity style={styles.button} onPress={() => openTourEditor()}>
          <Text style={styles.buttonText}>+ Add Tour</Text>
        </TouchableOpacity>
      </View>
      {Platform.OS !== 'web' && tourDateField && editingTour && DateTimePickerComponent ? (
        <DateTimePickerComponent
          value={tourDateValue}
          mode={tourDateField === 'startTime' ? 'time' : 'date'}
          onChange={(_, date) => {
            if (!date) {
              setTourDateField(null);
              return;
            }
            const iso = date.toISOString().slice(0, 10);
            setEditingTour((prev) => {
              if (!prev) return prev;
              if (tourDateField === 'startTime') {
                const hours = String(date.getHours()).padStart(2, '0');
                const mins = String(date.getMinutes()).padStart(2, '0');
                return { ...prev, startTime: `${hours}:${mins}` };
              }
              if (tourDateField === 'date') return { ...prev, date: iso };
              if (tourDateField === 'bookedOn') return { ...prev, bookedOn: iso };
              return { ...prev, freeCancelBy: iso };
            });
            setTourDateField(null);
          }}
        />
      ) : null}
      <ScrollView horizontal style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            {[
              { label: 'Date', width: 140 },
              { label: 'Tour', width: 180 },
              { label: 'Start Location', width: 180 },
              { label: 'Start Time', width: 120 },
              { label: 'Duration', width: 120 },
              { label: 'Cost', width: 120 },
              { label: 'Free Cancel By', width: 160 },
              { label: 'Platform Booked On', width: 140 },
              { label: 'Reference', width: 140 },
              { label: 'Paid By', width: 180 },
              { label: 'Actions', width: 160 },
            ].map((col, idx, arr) => (
              <View key={col.label} style={[styles.cell, { minWidth: col.width, flex: 1 }, idx === arr.length - 1 && styles.lastCell]}>
                <Text style={styles.headerText}>{col.label}</Text>
              </View>
            ))}
          </View>
          {tours.map((t) => (
            <View key={t.id} style={styles.tableRow}>
              <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                <Text style={styles.cellText}>{formatDateLong(t.date)}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                <Text style={styles.cellText}>{t.name || '-'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                <Text style={styles.cellText}>{t.startLocation || '-'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                <Text style={styles.cellText}>{t.startTime || '-'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                <Text style={styles.cellText}>{t.duration || '-'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                <Text style={styles.cellText}>{t.cost ? `$${t.cost}` : '-'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 160, flex: 1 }]}>
                <Text style={styles.cellText}>{t.freeCancelBy ? formatDateLong(t.freeCancelBy) : '-'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                <Text style={styles.cellText}>{t.bookedOn || '-'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                <Text style={styles.cellText}>{t.reference || '-'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                <Text style={styles.cellText}>{t.paidBy.length ? t.paidBy.map(payerName).join(', ') : '-'}</Text>
              </View>
              <View style={[styles.cell, styles.actionCell, styles.lastCell, { minWidth: 160, flex: 1 }]}>
                <TouchableOpacity style={[styles.smallButton]} onPress={() => openTourEditor(t)}>
                  <Text style={styles.buttonText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.smallButton, styles.dangerButton]} onPress={() => removeTour(t.id)}>
                  <Text style={styles.buttonText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={{ marginTop: 8 }}>
        <Text style={styles.flightTitle}>Total tour cost: ${toursTotal.toFixed(2)}</Text>
        {payerTotalsList.length ? (
          <View style={{ marginTop: 4 }}>
            {payerTotalsList.map(([id, total]) => (
              <Text key={id} style={styles.helperText}>
                {payerName(id)}: ${total.toFixed(2)}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
      {editingTour ? (
        <View style={styles.passengerOverlay}>
          <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={closeTourEditor} />
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>{editingTourId ? 'Edit Tour' : 'Add Tour'}</Text>
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingRight: 12 }}>
              <Text style={styles.modalLabel}>Date</Text>
              {Platform.OS === 'web' ? (
                <input
                  style={{ ...StyleSheet.flatten(styles.input), width: '100%' }}
                  type="date"
                  value={editingTour.date}
                  onChange={(e) => setEditingTour((p) => (p ? { ...p, date: e.target.value } : p))}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openTourDatePicker('date')}>
                  <Text style={styles.cellText}>{formatDateLong(editingTour.date)}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Tour</Text>
              <TextInput
                style={styles.input}
                placeholder="Tour name"
                value={editingTour.name}
                onChangeText={(text: string) => setEditingTour((p) => (p ? { ...p, name: text } : p))}
              />
              <Text style={styles.modalLabel}>Start location</Text>
              <TextInput
                style={styles.input}
                placeholder="Start location"
                value={editingTour.startLocation}
                onChangeText={(text: string) => setEditingTour((p) => (p ? { ...p, startLocation: text } : p))}
              />
              <Text style={styles.modalLabel}>Start time</Text>
              {Platform.OS === 'web' ? (
                <input
                  style={{ ...StyleSheet.flatten(styles.input), width: '100%' }}
                  type="time"
                  value={editingTour.startTime}
                  onChange={(e) => setEditingTour((p) => (p ? { ...p, startTime: e.target.value } : p))}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openTourDatePicker('startTime')}>
                  <Text style={styles.cellText}>{editingTour.startTime || 'Select time'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Duration</Text>
              <TextInput
                style={styles.input}
                placeholder="Duration"
                value={editingTour.duration}
                onChangeText={(text: string) => setEditingTour((p) => (p ? { ...p, duration: text } : p))}
              />
              <Text style={styles.modalLabel}>Cost</Text>
              <TextInput
                style={styles.input}
                placeholder="Cost"
                keyboardType="numeric"
                value={editingTour.cost}
                onChangeText={(text: string) => setEditingTour((p) => (p ? { ...p, cost: text.replace(/[^0-9.]/g, '') } : p))}
              />
              <View style={styles.modalRow}>
                <Text style={styles.modalLabel}>Free cancellation by</Text>
                <TouchableOpacity onPress={() => setEditingTour((p) => (p ? { ...p, freeCancelBy: '' } : p))}>
                  <Text style={styles.linkText}>Clear</Text>
                </TouchableOpacity>
              </View>
              {Platform.OS === 'web' ? (
                <input
                  style={{ ...StyleSheet.flatten(styles.input), width: '100%' }}
                  type="date"
                  value={editingTour.freeCancelBy}
                  onChange={(e) => setEditingTour((p) => (p ? { ...p, freeCancelBy: e.target.value } : p))}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openTourDatePicker('freeCancel')}>
                  <Text style={styles.cellText}>{editingTour.freeCancelBy ? formatDateLong(editingTour.freeCancelBy) : 'Select date'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Platform Booked On</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Viator, Get Your Guide, Klook, etc."
                  value={editingTour.bookedOn}
                  onChangeText={(text: string) => setEditingTour((p) => (p ? { ...p, bookedOn: text } : p))}
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Reference"
                  value={editingTour.reference}
                  onChangeText={(text: string) => setEditingTour((p) => (p ? { ...p, reference: text } : p))}
                />
              </View>
              <Text style={styles.modalLabel}>Paid by</Text>
              <View style={[styles.input, styles.payerBox]}>
                <View style={styles.payerChips}>
                  {editingTour.paidBy.map((id) => (
                    <View key={id} style={styles.payerChip}>
                      <Text style={styles.cellText}>{payerName(id)}</Text>
                      <TouchableOpacity onPress={() => setEditingTour((p) => (p ? { ...p, paidBy: p.paidBy.filter((x) => x !== id) } : p))}>
                        <Text style={styles.removeText}>x</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
                <View style={styles.payerOptions}>
                  {userMembers
                    .filter((m) => !editingTour.paidBy.includes(m.id))
                    .map((m) => (
                      <TouchableOpacity
                        key={m.id}
                        style={styles.smallButton}
                        onPress={() => setEditingTour((p) => (p ? { ...p, paidBy: [...p.paidBy, m.id] } : p))}
                      >
                        <Text style={styles.buttonText}>Add {formatMemberName(m)}</Text>
                      </TouchableOpacity>
                    ))}
                </View>
              </View>
            </ScrollView>
            <View style={[styles.tableFooter, { justifyContent: 'space-between' }]}>
              <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={closeTourEditor}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={saveTour}>
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
};
