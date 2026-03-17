import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

type ReviewItem = {
  id: string;
  itemType: string;
  sourceType: string;
  providerVendor?: string | null;
  confirmationNumber?: string | null;
  confidenceScore: number;
  status: string;
  travelerNames: string[];
  startDateTimeUtc?: string | null;
  duplicateDisposition?: string | null;
  duplicateOfTripId?: string | null;
  extractedFields: Record<string, unknown>;
  editedFields?: Record<string, unknown> | null;
};

type ImportJob = {
  id: string;
  state: string;
  originalFilename: string;
  createdAt: string;
  failureCode?: string | null;
};

type ConfigResponse = {
  tierKey: string;
  features: {
    manualUpload: boolean;
    forwardedMailbox: boolean;
    gmailImport: boolean;
  };
  quotas: {
    monthlyUploads: number;
    gmailLookbackDays: number;
    llmEscalations: string;
  };
  forwarding: {
    currentAddress: string;
    instructions: string;
    adminManagedNote: string;
  };
  gmail: {
    scope: string;
    inboxOnly: boolean;
    dryRunSupported: boolean;
  };
};

type Trip = {
  id: string;
  name: string;
};

type IngestionTabProps = {
  backendUrl: string;
  headers: Record<string, string>;
  styles: Record<string, any>;
  onNavigate: (page: string) => void;
};

const prettyDate = (value?: string | null): string => {
  if (!value) return 'Date unknown';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const openFilePicker = async (): Promise<File[]> => {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return [];
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.html,.htm,.pdf,.png,.jpg,.jpeg,.webp';
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
};

const IngestionTab: React.FC<IngestionTabProps> = ({ backendUrl, headers, styles, onNavigate }) => {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedItem, setSelectedItem] = useState<ReviewItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [editProvider, setEditProvider] = useState('');
  const [editConfirmation, setEditConfirmation] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [assignTripId, setAssignTripId] = useState<string>('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [configRes, itemsRes, jobsRes, tripsRes] = await Promise.all([
        fetch(`${backendUrl}/api/ingestion/config`, { headers }),
        fetch(`${backendUrl}/api/ingestion/review-items`, { headers }),
        fetch(`${backendUrl}/api/ingestion/jobs`, { headers }),
        fetch(`${backendUrl}/api/ingestion/assignment/trips`, { headers }),
      ]);
      const configData = await configRes.json();
      setConfig(configData);
      if (itemsRes.ok) {
        const itemsData = await itemsRes.json();
        setItems(itemsData.items ?? []);
      } else {
        setItems([]);
      }
      if (jobsRes.ok) {
        const jobsData = await jobsRes.json();
        setJobs(jobsData.jobs ?? []);
      } else {
        setJobs([]);
      }
      if (tripsRes.ok) {
        const tripsData = await tripsRes.json();
        setTrips((tripsData.trips ?? []).map((trip: any) => ({ id: trip.id, name: trip.name })));
      } else {
        setTrips([]);
      }
    } catch (err) {
      setError('Unable to load ingestion queue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
      if (sourceFilter !== 'ALL' && item.sourceType !== sourceFilter) return false;
      if (typeFilter !== 'ALL' && item.itemType !== typeFilter) return false;
      if (!search.trim()) return true;
      const haystack = JSON.stringify({
        provider: item.providerVendor,
        confirmation: item.confirmationNumber,
        fields: item.extractedFields,
      }).toLowerCase();
      return haystack.includes(search.trim().toLowerCase());
    });
  }, [items, search, sourceFilter, statusFilter, typeFilter]);

  const beginEdit = (item: ReviewItem) => {
    setSelectedItem(item);
    setEditProvider(String(item.editedFields?.providerVendor ?? item.providerVendor ?? ''));
    setEditConfirmation(String(item.editedFields?.confirmationNumber ?? item.confirmationNumber ?? ''));
    setEditNotes(String(item.editedFields?.notes ?? item.extractedFields?.notes ?? item.extractedFields?.summary ?? ''));
    setAssignTripId('');
  };

  const saveEdits = async () => {
    if (!selectedItem) return;
    const editedFields = {
      providerVendor: editProvider.trim() || null,
      confirmationNumber: editConfirmation.trim() || null,
      notes: editNotes.trim() || null,
    };
    await fetch(`${backendUrl}/api/ingestion/review-items/${selectedItem.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ editedFields }),
    });
    await load();
  };

  const assignItem = async () => {
    if (!selectedItem || !assignTripId) return;
    const editedFields = {
      providerVendor: editProvider.trim() || null,
      confirmationNumber: editConfirmation.trim() || null,
      notes: editNotes.trim() || null,
    };
    await fetch(`${backendUrl}/api/ingestion/review-items/${selectedItem.id}/assign`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tripId: assignTripId, editedFields }),
    });
    setSelectedItem(null);
    await load();
  };

  const deleteItem = async (itemId: string) => {
    await fetch(`${backendUrl}/api/ingestion/review-items/${itemId}`, {
      method: 'DELETE',
      headers,
    });
    if (selectedItem?.id === itemId) setSelectedItem(null);
    await load();
  };

  const uploadFiles = async () => {
    const files = await openFilePicker();
    if (!files.length) return;
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    const response = await fetch(`${backendUrl}/api/ingestion/upload`, {
      method: 'POST',
      headers: headers.Authorization ? { Authorization: headers.Authorization } : headers,
      body: formData,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError((body as any).error ?? 'Upload failed.');
      return;
    }
    await load();
  };

  if (!config) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Ingest</Text>
        <Text style={styles.helperText}>{loading ? 'Loading ingestion settings…' : error ?? 'Unable to load ingestion.'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Ingest & Review</Text>
      <Text style={styles.helperText}>
        {config.tierKey === 'free'
          ? 'Premium or Pro is required to upload and review imported travel items.'
          : `Plan: ${config.tierKey}. Upload quota: ${config.quotas.monthlyUploads} per month. Gmail lookback: ${config.quotas.gmailLookbackDays} days.`}
      </Text>
      <View style={styles.row}>
        <TextInput style={[styles.input, { flex: 1, minWidth: 220 }]} value={search} onChangeText={setSearch} placeholder="Search provider or confirmation" />
        <TouchableOpacity style={styles.button} onPress={load}>
          <Text style={styles.buttonText}>Refresh</Text>
        </TouchableOpacity>
        {config.features.manualUpload ? (
          <TouchableOpacity style={styles.button} onPress={uploadFiles}>
            <Text style={styles.buttonText}>Manual Upload</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.row}>
        <TextInput style={[styles.input, { flex: 1, minWidth: 160 }]} value={statusFilter} onChangeText={setStatusFilter} placeholder="Status or ALL" />
        <TextInput style={[styles.input, { flex: 1, minWidth: 160 }]} value={sourceFilter} onChangeText={setSourceFilter} placeholder="Source or ALL" />
        <TextInput style={[styles.input, { flex: 1, minWidth: 160 }]} value={typeFilter} onChangeText={setTypeFilter} placeholder="Type or ALL" />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Forwarding</Text>
        <Text style={styles.helperText}>{config.forwarding.currentAddress}</Text>
        <Text style={styles.helperText}>{config.forwarding.instructions}</Text>
        <Text style={styles.helperText}>{config.forwarding.adminManagedNote}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Queued Items</Text>
        {filteredItems.length === 0 ? <Text style={styles.helperText}>No items are waiting in review.</Text> : null}
        {filteredItems.map((item) => (
          <TouchableOpacity key={item.id} style={styles.flightRow} onPress={() => beginEdit(item)}>
            <Text style={styles.flightTitle}>
              {item.itemType} • {item.providerVendor || 'Unknown provider'}
            </Text>
            <Text style={styles.helperText}>
              {item.status} • confidence {item.confidenceScore.toFixed(2)} • {prettyDate(item.startDateTimeUtc)}
            </Text>
            {item.duplicateDisposition ? (
              <Text style={styles.warningText}>
                {item.duplicateDisposition === 'PREVIOUSLY_DELETED'
                  ? 'Previously Deleted'
                  : item.duplicateOfTripId
                    ? 'Potential Duplicate in Trip'
                    : 'Potential Duplicate'}
              </Text>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Jobs</Text>
        {jobs.map((job) => (
          <View key={job.id} style={styles.flightRow}>
            <Text style={styles.flightTitle}>{job.originalFilename}</Text>
            <Text style={styles.helperText}>{job.state} • {prettyDate(job.createdAt)}</Text>
            {job.failureCode ? <Text style={styles.warningText}>{job.failureCode}</Text> : null}
          </View>
        ))}
      </View>

      {selectedItem ? (
        <Modal transparent animationType="fade" visible>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { maxWidth: 720 }]}>
              <ScrollView style={{ maxHeight: 520 }}>
                <Text style={styles.sectionTitle}>Review Item</Text>
                <Text style={styles.helperText}>{selectedItem.itemType} • {selectedItem.status}</Text>
                <Text style={styles.helperText}>{JSON.stringify(selectedItem.extractedFields, null, 2)}</Text>
                <Text style={styles.modalLabel}>Provider</Text>
                <TextInput style={styles.input} value={editProvider} onChangeText={setEditProvider} />
                <Text style={styles.modalLabel}>Confirmation</Text>
                <TextInput style={styles.input} value={editConfirmation} onChangeText={setEditConfirmation} />
                <Text style={styles.modalLabel}>Notes</Text>
                <TextInput style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]} multiline value={editNotes} onChangeText={setEditNotes} />
                <Text style={styles.modalLabel}>Assign to Trip</Text>
                {trips.length === 0 ? (
                  <View>
                    <Text style={styles.helperText}>Create a trip first before assigning imported items.</Text>
                    <TouchableOpacity style={styles.button} onPress={() => onNavigate('create-trip')}>
                      <Text style={styles.buttonText}>Create Trip</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <TextInput style={styles.input} value={assignTripId} onChangeText={setAssignTripId} placeholder="Paste or select a trip id" />
                    {trips.map((trip) => (
                      <TouchableOpacity key={trip.id} style={styles.navButton} onPress={() => setAssignTripId(trip.id)}>
                        <Text style={styles.navButtonText}>{trip.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </ScrollView>
              <View style={styles.row}>
                <TouchableOpacity style={styles.button} onPress={saveEdits}>
                  <Text style={styles.buttonText}>Save Edits</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={assignItem} disabled={!assignTripId}>
                  <Text style={styles.buttonText}>Assign</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, styles.tableActionButtonDanger]} onPress={() => deleteItem(selectedItem.id)}>
                  <Text style={styles.buttonText}>Delete</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={() => setSelectedItem(null)}>
                  <Text style={styles.buttonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
};

export default IngestionTab;
