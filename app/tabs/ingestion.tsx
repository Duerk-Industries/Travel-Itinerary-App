import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

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
  timezoneStatus?: string | null;
  rawDatetimeString?: string | null;
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
  failureReason?: string | null;
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
    provider?: string;
    currentAddress: string;
    instructions: string;
    adminManagedNote: string;
  };
  gmail: {
    scope: string;
    inboxOnly: boolean;
    dryRunSupported: boolean;
    connection?: {
      connected: boolean;
      status?: string;
      emailAddress?: string | null;
      tokenExpiry?: string | null;
      scopes?: string[];
    };
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
  onAssignmentApplied?: (params: { itemType: string; tripId: string }) => void | Promise<void>;
};

const prettyDate = (value?: string | null): string => {
  if (!value) return 'Date unknown';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const ACTIVE_JOB_STATES = new Set(['PENDING', 'RECEIVED', 'NORMALIZING', 'NORMALIZED', 'EXTRACTING', 'AWAITING_REVIEW']);

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

const IngestionTab: React.FC<IngestionTabProps> = ({
  backendUrl,
  headers,
  styles,
  onNavigate,
  onAssignmentApplied,
}) => {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedItem, setSelectedItem] = useState<ReviewItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastTapRef = React.useRef<{ id: string; time: number }>({ id: '', time: 0 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [editProvider, setEditProvider] = useState('');
  const [editConfirmation, setEditConfirmation] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [assignTripId, setAssignTripId] = useState<string>('');
  const [dateFilter, setDateFilter] = useState('');
  const [confidenceFilter, setConfidenceFilter] = useState('');
  const [gmailMessages, setGmailMessages] = useState<Array<{ id: string; subject: string; receivedAt: string }>>([]);
  const [selectedDocumentSummary, setSelectedDocumentSummary] = useState<null | {
    normalizationQuality?: string | null;
    virusScanStatus?: string | null;
    mimeType?: string | null;
    originalFilename?: string | null;
  }>(null);
  const [signedDocumentUrl, setSignedDocumentUrl] = useState<string | null>(null);

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
    void load();
  }, []);

  useEffect(() => {
    if (!jobs.some((job) => ACTIVE_JOB_STATES.has(job.state))) {
      return;
    }
    const intervalId = setInterval(() => {
      void load();
    }, 3000);
    return () => clearInterval(intervalId);
  }, [jobs]);

  const filteredItems = useMemo(() => {
    const minConf = confidenceFilter ? Number(confidenceFilter) : null;
    return items.filter((item) => {
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
      if (sourceFilter !== 'ALL' && item.sourceType !== sourceFilter) return false;
      if (typeFilter !== 'ALL' && item.itemType !== typeFilter) return false;
      if (dateFilter && item.startDateTimeUtc && item.startDateTimeUtc.slice(0, 10) < dateFilter) return false;
      if (minConf !== null && Number.isFinite(minConf) && item.confidenceScore < minConf) return false;
      if (!search.trim()) return true;
      const haystack = JSON.stringify({
        provider: item.providerVendor,
        confirmation: item.confirmationNumber,
        fields: item.extractedFields,
      }).toLowerCase();
      return haystack.includes(search.trim().toLowerCase());
    });
  }, [items, search, sourceFilter, statusFilter, typeFilter, dateFilter, confidenceFilter]);

  const beginEdit = async (item: ReviewItem) => {
    setSelectedItem(item);
    setEditProvider(String(item.editedFields?.providerVendor ?? item.providerVendor ?? ''));
    setEditConfirmation(String(item.editedFields?.confirmationNumber ?? item.confirmationNumber ?? ''));
    setEditNotes(String(item.editedFields?.notes ?? item.extractedFields?.notes ?? item.extractedFields?.summary ?? ''));
    setAssignTripId('');
    setSignedDocumentUrl(null);
    const response = await fetch(`${backendUrl}/api/ingestion/review-items/${item.id}`, {
      headers,
    });
    const body = await response.json().catch(() => ({}));
    setSelectedDocumentSummary((body as any).documentSummary ?? null);
    setSignedDocumentUrl((body as any).signedDocument ?? null);
  };

  const openDocument = () => {
    if (!signedDocumentUrl) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(signedDocumentUrl, '_blank');
    } else {
      Linking.openURL(signedDocumentUrl).catch(() => {});
    }
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
    const tripId = assignTripId;
    const itemType = selectedItem.itemType;
    const editedFields = {
      providerVendor: editProvider.trim() || null,
      confirmationNumber: editConfirmation.trim() || null,
      notes: editNotes.trim() || null,
    };
    const response = await fetch(`${backendUrl}/api/ingestion/review-items/${selectedItem.id}/assign`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tripId, editedFields }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError((body as any).error ?? 'Unable to assign item to trip.');
      return;
    }
    await onAssignmentApplied?.({ itemType, tripId });
    setSelectedDocumentSummary(null);
    setSelectedItem(null);
    await load();
  };

  const deleteItem = async (itemId: string) => {
    await fetch(`${backendUrl}/api/ingestion/review-items/${itemId}`, {
      method: 'DELETE',
      headers,
    });
    if (selectedItem?.id === itemId) {
      setSelectedItem(null);
      setSelectedDocumentSummary(null);
    }
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

  const openExternalUrl = async (url: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    await Linking.openURL(url);
  };

  const connectGmail = async () => {
    const redirectUri =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? `${window.location.origin}/app`
        : undefined;
    const response = await fetch(`${backendUrl}/api/ingestion/gmail/connect`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirectUri }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !(body as any).authUrl) {
      setError((body as any).error ?? 'Unable to start Gmail connection.');
      return;
    }
    await openExternalUrl((body as any).authUrl);
  };

  const disconnectGmail = async () => {
    const response = await fetch(`${backendUrl}/api/ingestion/gmail/disconnect`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError((body as any).error ?? 'Unable to disconnect Gmail.');
      return;
    }
    setGmailMessages([]);
    await load();
  };

  const runGmailDryRun = async () => {
    const response = await fetch(`${backendUrl}/api/ingestion/gmail/dry-run`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError((body as any).error ?? 'Unable to run Gmail dry run.');
      return;
    }
    setGmailMessages((body as any).messages ?? []);
  };

  const runGmailImport = async () => {
    const response = await fetch(`${backendUrl}/api/ingestion/gmail/import`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError((body as any).error ?? 'Unable to import Gmail messages.');
      return;
    }
    setGmailMessages([]);
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
      {jobs.some((job) => ACTIVE_JOB_STATES.has(job.state)) ? (
        <Text style={styles.helperText}>Auto-refreshing while uploads process so pending jobs do not appear stuck.</Text>
      ) : null}
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
        <TextInput style={[styles.input, { flex: 1, minWidth: 120 }]} value={statusFilter} onChangeText={setStatusFilter} placeholder="Status or ALL" />
        <TextInput style={[styles.input, { flex: 1, minWidth: 120 }]} value={sourceFilter} onChangeText={setSourceFilter} placeholder="Source or ALL" />
        <TextInput style={[styles.input, { flex: 1, minWidth: 120 }]} value={typeFilter} onChangeText={setTypeFilter} placeholder="Type or ALL" />
        <TextInput style={[styles.input, { flex: 1, minWidth: 120 }]} value={dateFilter} onChangeText={setDateFilter} placeholder="Date from (YYYY-MM-DD)" />
        <TextInput style={[styles.input, { flex: 1, minWidth: 100 }]} value={confidenceFilter} onChangeText={setConfidenceFilter} placeholder="Min confidence" keyboardType="numeric" />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Forwarding</Text>
        <Text style={styles.helperText}>Provider: {config.forwarding.provider || 'mailgun'}</Text>
        <Text style={styles.helperText}>{config.forwarding.currentAddress}</Text>
        <Text style={styles.helperText}>{config.forwarding.instructions}</Text>
        <Text style={styles.helperText}>{config.forwarding.adminManagedNote}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Gmail Import</Text>
        <Text style={styles.helperText}>Scope review: {config.gmail.scope}</Text>
        <Text style={styles.helperText}>Inbox only: {config.gmail.inboxOnly ? 'Yes' : 'No'}</Text>
        <Text style={styles.helperText}>
          Connection: {config.gmail.connection?.connected ? `Connected${config.gmail.connection.emailAddress ? ` as ${config.gmail.connection.emailAddress}` : ''}` : 'Not connected'}
        </Text>
        {config.gmail.connection?.status === 'AUTH_EXPIRED' ? (
          <Text style={styles.warningText}>Gmail access expired. Reconnect before the next sync or import.</Text>
        ) : null}
        {config.gmail.connection?.tokenExpiry ? (
          <Text style={styles.helperText}>Token expiry: {prettyDate(config.gmail.connection.tokenExpiry)}</Text>
        ) : null}
        <View style={styles.row}>
          {config.features.gmailImport ? (
            <>
              <TouchableOpacity style={styles.button} onPress={connectGmail}>
                <Text style={styles.buttonText}>{config.gmail.connection?.connected ? 'Reconnect Gmail' : 'Connect Gmail'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={runGmailDryRun} disabled={!config.gmail.connection?.connected}>
                <Text style={styles.buttonText}>Dry Run</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={runGmailImport} disabled={!config.gmail.connection?.connected}>
                <Text style={styles.buttonText}>Import Gmail</Text>
              </TouchableOpacity>
              {config.gmail.connection?.connected ? (
                <TouchableOpacity style={[styles.button, styles.tableActionButtonDanger]} onPress={disconnectGmail}>
                  <Text style={styles.buttonText}>Disconnect</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : (
            <Text style={styles.helperText}>Gmail import is currently disabled.</Text>
          )}
        </View>
        {gmailMessages.length > 0 ? (
          <View>
            {gmailMessages.map((message) => (
              <View key={message.id} style={styles.flightRow}>
                <Text style={styles.flightTitle}>{message.subject}</Text>
                <Text style={styles.helperText}>{prettyDate(message.receivedAt)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Queued Items</Text>
        {filteredItems.length === 0 ? <Text style={styles.helperText}>No items are waiting in review.</Text> : null}
        {filteredItems.map((item) => (
          <TouchableOpacity key={item.id} style={styles.flightRow} onPress={() => {
            const now = Date.now();
            const last = lastTapRef.current;
            if (last.id === item.id && now - last.time < 400) {
              // Double tap — fetch signed URL and open the original document
              lastTapRef.current = { id: '', time: 0 };
              fetch(`${backendUrl}/api/ingestion/review-items/${item.id}`, { headers })
                .then((r) => r.json())
                .then((body: any) => {
                  const url = body?.signedDocument;
                  if (url) {
                    if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank');
                    else Linking.openURL(url).catch(() => {});
                  }
                })
                .catch(() => {});
              return;
            }
            lastTapRef.current = { id: item.id, time: now };
            beginEdit(item);
          }}>
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
            {job.failureReason ? <Text style={styles.helperText}>{job.failureReason}</Text> : null}
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
                {selectedItem.timezoneStatus === 'UNKNOWN' ? (
                  <Text style={styles.warningText}>Timezone unknown{selectedItem.rawDatetimeString ? ` (raw: ${selectedItem.rawDatetimeString})` : ''}</Text>
                ) : null}
                {selectedDocumentSummary ? (
                  <Text style={styles.helperText}>
                    {selectedDocumentSummary.originalFilename || 'Document'} • normalization {selectedDocumentSummary.normalizationQuality || 'unknown'} • virus scan {selectedDocumentSummary.virusScanStatus || 'unknown'}
                  </Text>
                ) : null}
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
                {signedDocumentUrl ? (
                  <TouchableOpacity style={styles.button} onPress={openDocument}>
                    <Text style={styles.buttonText}>View Document</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={styles.button} onPress={saveEdits}>
                  <Text style={styles.buttonText}>Save Edits</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={assignItem} disabled={!assignTripId}>
                  <Text style={styles.buttonText}>Assign</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, styles.tableActionButtonDanger]} onPress={() => deleteItem(selectedItem.id)}>
                  <Text style={styles.buttonText}>Delete</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.button}
                  onPress={() => {
                    setSelectedItem(null);
                    setSelectedDocumentSummary(null);
                    setSignedDocumentUrl(null);
                  }}
                >
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
