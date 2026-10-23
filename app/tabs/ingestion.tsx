import ImportSuggestionReview from '../components/ImportSuggestionReview';
import type { ImportTripDraft, ImportForwarderTrust, Trip as DomainTrip } from '../../server/src/types';
import AutomaticImportSettings from '../components/AutomaticImportSettings';
import ImportForwardingSetup from '../components/ImportForwardingSetup';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { usePolling } from '../hooks/usePolling';
import DateField from '../components/DateField';
import type { AppTheme } from '../theme/theme';
import { taskFailure, track } from '../utils/analytics/track';

// Imports from the Imports tab carry no trip: items are assigned to a trip later, in review.
const IMPORT_TASK = { task: 'import', feature: 'imports' } as const;

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
    autoAssign?: boolean;
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
    receipts?: Array<{ id: string; state: string; expiresAt: number; holdReason?: string }>;
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

type Trip = Pick<DomainTrip, 'id' | 'name'>;

type IngestionTabProps = {
  backendUrl: string;
  headers: Record<string, string>;
  styles: Record<string, any>;
  theme?: AppTheme;
  onNavigate: (page: string) => void;
  onCreateTripFromImport?: (itemId: string, draft: ImportTripDraft) => void;
  initialReview?: { itemId: string; tripId: string } | null;
  onInitialReviewHandled?: () => void;
  onAssignmentApplied?: (params: { itemType: string; tripId: string }) => void | Promise<void>;
  // Admins get the full operational view (search/status/source/type/date/confidence filters,
  // forwarding provider/instructions detail, bulk select+assign+delete, and the Gmail section's
  // disabled state spelled out). Everyone else gets the simplified page below: the forwarding
  // address, Manual Upload, Queued Items, Recent Jobs, and Gmail Import only when it's actually
  // enabled. Defaults to the simplified view — a caller that forgets to pass a role should never
  // land a regular user on the admin/debug surface by accident.
  userRole?: 'user' | 'admin';
};

const prettyDate = (value?: string | null): string => {
  if (!value) return 'Date unknown';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const ACTIVE_JOB_STATES = new Set(['PENDING', 'RECEIVED', 'NORMALIZING', 'NORMALIZED', 'EXTRACTING', 'AWAITING_REVIEW']);

const openFilePicker = async (): Promise<File[]> => {
  if (Platform.OS !== 'web') {
    const picker = await import('expo-document-picker');
    const result = await picker.getDocumentAsync({ type: ['text/plain', 'text/html', 'text/calendar', 'application/pdf', 'image/*'], multiple: true, copyToCacheDirectory: true });
    return result.canceled ? [] : result.assets.map(asset => ({ uri: asset.uri, name: asset.name, type: asset.mimeType || 'application/octet-stream' } as unknown as File));
  }
  if (typeof document === 'undefined') return [];
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.html,.htm,.ics,.pdf,.png,.jpg,.jpeg,.webp';
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
};

const IngestionTab: React.FC<IngestionTabProps> = ({
  backendUrl,
  headers,
  styles,
  theme,
  onNavigate,
  onAssignmentApplied,
  onCreateTripFromImport, initialReview, onInitialReviewHandled,
  userRole = 'user',
}) => {
  const isAdmin = userRole === 'admin';
  const scope = `${backendUrl}:${JSON.stringify(headers)}`;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const editRequest = useRef(0);
  const mutation = useRef<string | null>(null);
  const [mutationScope, setMutationScope] = useState('');
  const [detailReady, setDetailReady] = useState(false);
  const [loadedScope, setLoadedScope] = useState('');
  const [forwarderTrust, setForwarderTrust] = useState<ImportForwarderTrust>('uncertain');
  const [tripDraft, setTripDraft] = useState<ImportTripDraft | null>(null);
  const [choices, setChoices] = useState<Array<{ tripId: string; tripName: string; reasons: string[]; strong: boolean }>>([]);
  const initialHandled = useRef('');

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
  const [suggestionReasons, setSuggestionReasons] = useState<string[]>([]);
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAssignTripId, setBulkAssignTripId] = useState<string>('');

  const load = async () => {
    const requestScope = scope; setLoading(true); setError(null);
    try {
      const responses = await Promise.all([
        fetch(`${backendUrl}/api/ingestion/config`, { headers }), fetch(`${backendUrl}/api/ingestion/review-items`, { headers }),
        fetch(`${backendUrl}/api/ingestion/jobs`, { headers }), fetch(`${backendUrl}/api/ingestion/assignment/trips`, { headers }),
      ]);
      if (!responses[0]!.ok) throw new Error('Import settings unavailable');
      const [settings, queue, recent, choices] = await Promise.all(responses.map(response => response.ok ? response.json() : Promise.resolve({})));
      if (scopeRef.current !== requestScope) return;
      setConfig(settings); setItems(queue.items ?? []); setJobs(recent.jobs ?? []);
      setTrips((choices.trips ?? []).map((trip: Trip) => ({ id: trip.id, name: trip.name }))); setLoadedScope(scope);
    } catch { if (scopeRef.current === requestScope) setError('Unable to load Imports. Try again.'); }
    finally { if (scopeRef.current === requestScope) setLoading(false); }
  };

  useEffect(() => {
    setItems([]); setJobs([]); setTrips([]); setSelectedItem(null); setDetailReady(false); setLoadedScope('');
    setMutationScope(''); setSelectedIds(new Set()); setBulkAssignTripId(''); editRequest.current += 1;
    void load();
    return () => { if (scopeRef.current === scope) scopeRef.current = ''; };
  }, [scope]);

  const refreshConfig = useCallback(async () => {
    const response = await fetch(`${backendUrl}/api/ingestion/config`, { headers, cache: 'no-store' });
    if (!response.ok) throw new Error('Import settings unavailable');
    const settings: ConfigResponse = await response.json();
    if (scopeRef.current === scope) setConfig(settings);
  }, [backendUrl, headers, scope]);
  usePolling({ enabled: loadedScope === scope, intervalMs: 15000, poll: refreshConfig, immediate: false });

  const jobsRef = useRef<ImportJob[]>(jobs);
  jobsRef.current = jobs;

  const hasActiveJobs = jobs.some((job) => ACTIVE_JOB_STATES.has(job.state));

  const pollJobs = useCallback(async () => {
    const jobsRes = await fetch(`${backendUrl}/api/ingestion/jobs`, { headers });
    if (!jobsRes.ok) return { done: false };
    const jobsData = await jobsRes.json().catch(() => ({}));
    if (scopeRef.current !== scope) return { done: true };
    const nextJobs: ImportJob[] = (jobsData as any).jobs ?? [];

    const prevJobs = jobsRef.current;
    const anyTransitionedOut = prevJobs.some((prev) => {
      const next = nextJobs.find((j) => j.id === prev.id);
      return ACTIVE_JOB_STATES.has(prev.state) && (!next || !ACTIVE_JOB_STATES.has(next.state));
    });

    setJobs(nextJobs);

    if (anyTransitionedOut) {
      const itemsRes = await fetch(`${backendUrl}/api/ingestion/review-items`, { headers });
      if (itemsRes.ok) {
        const itemsData = await itemsRes.json().catch(() => ({}));
        if (scopeRef.current === scope) setItems((itemsData as any).items ?? []);
      }
    }

    return { done: !nextJobs.some((job) => ACTIVE_JOB_STATES.has(job.state)) };
  }, [backendUrl, headers, scope]);

  usePolling({
    enabled: hasActiveJobs,
    intervalMs: 3000,
    poll: pollJobs,
    immediate: false,
  });

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

  const beginEdit = async (item: ReviewItem, preferredTripId?: string) => {
    const requestScope = scope, request = ++editRequest.current;
    setSelectedItem(item); setDetailReady(false); setTripDraft(null); setChoices([]); setForwarderTrust('uncertain');
    setAssignTripId(''); setSignedDocumentUrl(null); setSuggestionReasons([]); setEditProvider(''); setEditConfirmation(''); setEditNotes(''); setError(null);
    try {
      const response = await fetch(`${backendUrl}/api/ingestion/review-items/${item.id}`, { headers });
      const body = await response.json();
      if (scopeRef.current !== requestScope || editRequest.current !== request) return;
      if (!response.ok) throw new Error(body.error || 'This booking could not load. Close it and try again.');
      const fresh: ReviewItem = body.item ?? item;
      setSelectedItem(fresh);
      setEditProvider(String(fresh.editedFields?.providerVendor ?? fresh.providerVendor ?? ''));
      setEditConfirmation(String(fresh.editedFields?.confirmationNumber ?? fresh.confirmationNumber ?? ''));
      setEditNotes(String(fresh.editedFields?.notes ?? fresh.extractedFields?.notes ?? fresh.extractedFields?.summary ?? ''));
      const suggestions: Array<{ tripId: string; tripName: string; reasons: string[]; strong: boolean }> = body.suggestions ?? [];
      setChoices(suggestions);
      const strong = suggestions.filter(row => row.strong);
      const selected = preferredTripId && trips.some(trip => trip.id === preferredTripId) ? preferredTripId : strong.length === 1 ? strong[0]!.tripId : '';
      setAssignTripId(selected); setSuggestionReasons(suggestions.find(row => row.tripId === selected)?.reasons ?? []);
      setForwarderTrust(body.forwarderTrust === 'verified' ? 'verified' : body.forwarderTrust === 'not_forwarded' ? 'not_forwarded' : 'uncertain');
      setTripDraft(body.tripDraft ?? null); setSelectedDocumentSummary(body.documentSummary ?? null); setSignedDocumentUrl(body.signedDocument ?? null);
      setDetailReady(true);
    } catch (error) { if (scopeRef.current === requestScope && editRequest.current === request) setError((error as Error).message); }
  };
  useEffect(() => {
    if (!initialReview || loadedScope !== scope) return;
    const key = `${scope}:${initialReview.itemId}:${initialReview.tripId}`;
    if (initialHandled.current === key) return;
    initialHandled.current = key;
    const item = items.find(row => row.id === initialReview.itemId);
    if (item) void beginEdit(item, initialReview.tripId);
    else setError('This booking is no longer in the review queue. Refresh Imports to check its status.');
    onInitialReviewHandled?.();
  }, [initialReview, loadedScope, scope, items, trips]);

  const openDocument = () => {
    if (!signedDocumentUrl) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(signedDocumentUrl, '_blank');
    } else {
      Linking.openURL(signedDocumentUrl).catch(() => {});
    }
  };

  const saveEdits = async () => {
    if (!selectedItem || !detailReady || mutation.current === scope) return;
    const requestScope = scope; mutation.current = scope; setMutationScope(scope);
    try {
      const response = await fetch(`${backendUrl}/api/ingestion/review-items/${selectedItem.id}`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ editedFields: { providerVendor: editProvider.trim() || null, confirmationNumber: editConfirmation.trim() || null, notes: editNotes.trim() || null } }),
      });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Changes could not be saved. Your input is still here.');
      if (scopeRef.current !== requestScope) return;
      setSelectedItem(body); await load(); await beginEdit(body);
    } catch (error) { if (scopeRef.current === requestScope) setError((error as Error).message); }
    finally { if (mutation.current === requestScope) mutation.current = null; if (scopeRef.current === requestScope) setMutationScope(''); }
  };
  const assignItem = async () => {
    if (!selectedItem || !assignTripId || !detailReady || mutation.current === scope) return;
    const requestScope = scope, tripId = assignTripId, itemType = selectedItem.itemType;
    mutation.current = scope; setMutationScope(scope);
    try {
      const response = await fetch(`${backendUrl}/api/ingestion/review-items/${selectedItem.id}/assign`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tripId, editedFields: { providerVendor: editProvider.trim() || null, confirmationNumber: editConfirmation.trim() || null, notes: editNotes.trim() || null } }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'The result could not be confirmed. Refresh Imports before trying again.');
      if (scopeRef.current !== requestScope) return;
      setSelectedDocumentSummary(null); setSelectedItem(null);
      await onAssignmentApplied?.({ itemType, tripId });
      if (scopeRef.current === requestScope) await load();
    } catch (error) { if (scopeRef.current === requestScope) setError((error as Error).message); }
    finally { if (mutation.current === requestScope) mutation.current = null; if (scopeRef.current === requestScope) setMutationScope(''); }
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

  const toggleSelected = (itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const reportBulkFailures = (failed: Array<{ id: string; reason: string }>, prefix: string) => {
    if (!failed.length) return;
    const summary = failed
      .slice(0, 3)
      .map((entry) => `${entry.id.slice(0, 8)}: ${entry.reason}`)
      .join('; ');
    const overflow = failed.length > 3 ? ` (+${failed.length - 3} more)` : '';
    setError(`${prefix}: ${summary}${overflow}`);
  };

  const bulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const response = await fetch(`${backendUrl}/api/ingestion/review-items/bulk-delete`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 207) {
      setError((body as any).error ?? 'Bulk delete failed.');
      return;
    }
    reportBulkFailures((body as any).failed ?? [], 'Some items could not be deleted');
    clearSelection();
    await load();
  };

  const bulkAssign = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length || !bulkAssignTripId) return;
    const tripId = bulkAssignTripId;
    const response = await fetch(`${backendUrl}/api/ingestion/review-items/bulk-assign`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, tripId }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 207) {
      setError((body as any).error ?? 'Bulk assign failed.');
      return;
    }
    reportBulkFailures((body as any).failed ?? [], 'Some items could not be assigned');
    const assigned = ((body as any).assigned ?? []) as Array<{ id: string; tripId: string; itemType: string }>;
    for (const entry of assigned) {
      await onAssignmentApplied?.({ itemType: entry.itemType, tripId: entry.tripId });
    }
    clearSelection();
    setBulkAssignTripId('');
    await load();
  };

  const uploadFiles = async () => {
    track('task_started', IMPORT_TASK);
    const files = await openFilePicker();
    if (!files.length) {
      track('task_cancelled', IMPORT_TASK);
      return;
    }
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    let response: Response;
    try {
      response = await fetch(`${backendUrl}/api/ingestion/upload`, {
        method: 'POST',
        headers: headers.Authorization ? { Authorization: headers.Authorization } : headers,
        body: formData,
      });
    } catch (err) {
      track('task_failed', { ...IMPORT_TASK, failure: 'network' });
      throw err;
    }
    if (!response.ok) {
      track('task_failed', { ...IMPORT_TASK, failure: taskFailure(response.status) });
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
    track('task_started', IMPORT_TASK);
    let response: Response;
    try {
      response = await fetch(`${backendUrl}/api/ingestion/gmail/import`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch (err) {
      track('task_failed', { ...IMPORT_TASK, failure: 'network' });
      throw err;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      track('task_failed', { ...IMPORT_TASK, failure: taskFailure(response.status) });
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
      {config.features.autoAssign ? <AutomaticImportSettings backendUrl={backendUrl} headers={headers} onChanged={() => void load()} /> : null}
      <ImportSuggestionReview backendUrl={backendUrl} headers={headers} styles={styles}
        onReviewItem={id => { const item = items.find(row => row.id === id); if (item) void beginEdit(item); else setError('Refresh Imports to review this booking.'); }}
        onConfirmed={async assigned => { for (const entry of assigned) { if (scopeRef.current !== scope) return; await onAssignmentApplied?.({ itemType: entry.itemType, tripId: entry.tripId }); } if (scopeRef.current === scope) await load(); }} />
      <Text style={styles.helperText}>
        {config.tierKey === 'free'
          ? 'Premium or Pro is required to upload and review imported travel items.'
          : `Plan: ${config.tierKey}. Upload quota: ${config.quotas.monthlyUploads} per month. Gmail lookback: ${config.quotas.gmailLookbackDays} days.`}
      </Text>
      {jobs.some((job) => ACTIVE_JOB_STATES.has(job.state)) ? (
        <Text style={styles.helperText}>Auto-refreshing while uploads process so pending jobs do not appear stuck.</Text>
      ) : null}
      <View style={styles.row}>
        {isAdmin ? (
          <TextInput style={[styles.input, { flex: 1, minWidth: 220 }]} value={search} onChangeText={setSearch} placeholder="Search provider or confirmation" />
        ) : null}
        <TouchableOpacity style={styles.button} onPress={load}>
          <Text style={styles.buttonText}>Refresh</Text>
        </TouchableOpacity>
        {config.features.manualUpload ? (
          <TouchableOpacity style={styles.button} onPress={uploadFiles}>
            <Text style={styles.buttonText}>Manual Upload</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {isAdmin ? (
        <View style={styles.row}>
          <TextInput style={[styles.input, { flex: 1, minWidth: 120 }]} value={statusFilter} onChangeText={setStatusFilter} placeholder="Status or ALL" />
          <TextInput style={[styles.input, { flex: 1, minWidth: 120 }]} value={sourceFilter} onChangeText={setSourceFilter} placeholder="Source or ALL" />
          <TextInput style={[styles.input, { flex: 1, minWidth: 120 }]} value={typeFilter} onChangeText={setTypeFilter} placeholder="Type or ALL" />
          <DateField value={dateFilter} onChange={setDateFilter} styles={styles} theme={theme} style={{ flex: 1, minWidth: 120 }} placeholder="Date from" testID="ingestion-date-filter" accessibilityLabel="Date from" />
          <TextInput style={[styles.input, { flex: 1, minWidth: 100 }]} value={confidenceFilter} onChangeText={setConfidenceFilter} placeholder="Min confidence" keyboardType="numeric" />
        </View>
      ) : null}

      {config.features.forwardedMailbox ? <ImportForwardingSetup address={config.forwarding.currentAddress} backendUrl={backendUrl} headers={headers} styles={styles}
        onRotated={address => setConfig(current => current ? { ...current, forwarding: { ...current.forwarding, currentAddress: address } } : current)} />
        : null}

      {(config.features.forwardedMailbox ? config.forwarding.receipts ?? [] : []).filter(r => r.state !== 'COMPLETE').map(receipt => (
        <View key={receipt.id} style={styles.section}>
          <Text style={styles.helperText}>{receipt.holdReason === 'GMAIL_CONFIRMATION_UNVERIFIED' ? 'This forwarding confirmation could not be verified. Delete it and request another in Gmail; it will not be imported as a booking.' : receipt.state === 'HELD' ? 'Check this message before importing. Your plan allowance still applies.' : 'Received — preparing your booking preview.'}</Text>
          {receipt.state === 'HELD' && receipt.holdReason !== 'GMAIL_CONFIRMATION_UNVERIFIED' && <TouchableOpacity style={styles.button} accessibilityRole="button" onPress={() => {
            void fetch(`${backendUrl}/api/ingestion/forwarding/receipts/${receipt.id}/release`, { method: 'POST', headers }).then(async response => {
              if (!response.ok) { setError('Could not import this message. Check your allowance or try again later.'); return; }
              await load();
            }).catch(() => setError('Could not import this message. Please try again.'));
          }}><Text style={styles.buttonText}>Import once</Text></TouchableOpacity>}
          <TouchableOpacity style={styles.button} accessibilityRole="button" onPress={() => {
            void fetch(`${backendUrl}/api/ingestion/forwarding/receipts/${receipt.id}`, { method: 'DELETE', headers }).then(async response => {
              if (!response.ok) { setError('Could not delete this message. Please try again.'); return; }
              await load();
            }).catch(() => setError('Could not delete this message. Please try again.'));
          }}><Text style={styles.buttonText}>Delete message</Text></TouchableOpacity>
        </View>
      ))}

      {isAdmin && config.features.gmailImport ? (
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
      ) : config.features.gmailImport ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Gmail Import</Text>
          <Text style={styles.helperText}>
            {config.gmail.connection?.connected ? `Connected${config.gmail.connection.emailAddress ? ` as ${config.gmail.connection.emailAddress}` : ''}` : 'Not connected'}
          </Text>
          {config.gmail.connection?.status === 'AUTH_EXPIRED' ? (
            <Text style={styles.warningText}>Gmail access expired. Reconnect before the next sync or import.</Text>
          ) : null}
          <View style={styles.row}>
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
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Queued Items</Text>
        {filteredItems.length === 0 ? (
          <Text style={styles.helperText}>
            {items.length === 0
              ? 'No items have been imported yet.'
              : 'No items match the current filters. Clear a filter to see more.'}
          </Text>
        ) : null}
        {isAdmin && selectedIds.size > 0 ? (
          <View
            style={styles.row}
            accessibilityRole={Platform.OS === 'web' ? ('toolbar' as any) : undefined}
            accessibilityLabel={`Bulk actions for ${selectedIds.size} selected item${selectedIds.size === 1 ? '' : 's'}`}
          >
            <Text style={styles.helperText}>{selectedIds.size} selected</Text>
            <TouchableOpacity
              style={styles.button}
              onPress={clearSelection}
              accessibilityRole="button"
              accessibilityLabel="Clear selection"
            >
              <Text style={styles.buttonText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.tableActionButtonDanger]}
              onPress={bulkDelete}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${selectedIds.size} selected item${selectedIds.size === 1 ? '' : 's'}`}
            >
              <Text style={styles.dangerButtonText}>Delete Selected</Text>
            </TouchableOpacity>
            <TextInput
              style={[styles.input, { flex: 1, minWidth: 180 }]}
              value={bulkAssignTripId}
              onChangeText={setBulkAssignTripId}
              placeholder="Trip id for bulk assign"
              accessibilityLabel="Trip id for bulk assign"
            />
            <TouchableOpacity
              style={styles.button}
              onPress={bulkAssign}
              disabled={!bulkAssignTripId}
              accessibilityRole="button"
              accessibilityState={{ disabled: !bulkAssignTripId }}
              accessibilityLabel={`Assign ${selectedIds.size} selected item${selectedIds.size === 1 ? '' : 's'} to trip`}
            >
              <Text style={styles.buttonText}>Assign Selected</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {filteredItems.map((item) => {
          const checked = selectedIds.has(item.id);
          return (
            <View key={item.id} style={[styles.row, { alignItems: 'flex-start' }]}>
              {isAdmin ? (
                <TouchableOpacity
                  style={[styles.button, { paddingHorizontal: 10 }]}
                  onPress={() => toggleSelected(item.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  accessibilityLabel={`${checked ? 'Deselect' : 'Select'} ${item.itemType} from ${item.providerVendor || 'Unknown provider'}`}
                >
                  <Text style={styles.buttonText}>{checked ? '☑' : '☐'}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.flightRow, { flex: 1 }]}
                onPress={() => {
                  const now = Date.now();
                  const last = lastTapRef.current;
                  if (last.id === item.id && now - last.time < 400) {
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
                }}
              >
                {item.sourceType === 'FORWARDED_MAILBOX' && <Text style={styles.helperText}>We couldn't confirm who forwarded this — check it before adding.</Text>}
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
            </View>
          );
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Jobs</Text>
        {jobs.length === 0 ? (
          <Text style={styles.helperText}>No import jobs yet — upload a file or run Gmail import to see processing history here.</Text>
        ) : null}
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
        <Modal transparent animationType="fade" visible onRequestClose={() => setSelectedItem(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { maxWidth: 720 }]}>
              <ScrollView style={{ maxHeight: 520 }}>
                <Text style={styles.sectionTitle}>Review Item</Text>
                {error && <Text accessibilityRole="alert" style={styles.warningText}>{error}</Text>}
                <Text style={styles.helperText}>{isAdmin ? `${selectedItem.itemType} • ${selectedItem.status}` : `${selectedItem.itemType.replace(/_/g, ' ')} · Review before adding`}</Text>
                {!detailReady && <Text style={styles.helperText}>Loading booking details…</Text>}
                {selectedItem.timezoneStatus === 'UNKNOWN' ? (
                  <Text style={styles.warningText}>Timezone unknown{selectedItem.rawDatetimeString ? ` (raw: ${selectedItem.rawDatetimeString})` : ''}</Text>
                ) : null}
                {isAdmin && selectedDocumentSummary ? (
                  <Text style={styles.helperText}>
                    {selectedDocumentSummary.originalFilename || 'Document'} • normalization {selectedDocumentSummary.normalizationQuality || 'unknown'} • virus scan {selectedDocumentSummary.virusScanStatus || 'unknown'}
                  </Text>
                ) : null}
                {isAdmin ? <Text style={styles.helperText}>{JSON.stringify(selectedItem.extractedFields, null, 2)}</Text> : <>
                  <Text style={styles.helperText}>Imported by you · Check this booking before adding it.</Text>
                  {selectedItem.sourceType === 'FORWARDED_MAILBOX' && <Text style={styles.helperText}>{forwarderTrust === 'verified' ? 'Forwarding address verified. Check the booking details before adding.' : 'We couldn’t confirm who forwarded this — check it before adding.'}</Text>}
                  <Text style={styles.flightTitle}>{String(selectedItem.extractedFields.name || selectedItem.extractedFields.propertyName || selectedItem.providerVendor || 'Booking')}</Text>
                  <Text style={styles.helperText}>{selectedItem.startDateTimeUtc ? new Date(selectedItem.startDateTimeUtc).toLocaleString() : 'Check the local date and timezone.'}</Text>
                  <Text style={styles.helperText}>{String(selectedItem.extractedFields.address || selectedItem.extractedFields.startLocation || '')}</Text>
                </>}
                <Text style={styles.modalLabel}>Provider</Text>
                <TextInput style={styles.input} editable={detailReady && mutationScope !== scope} value={editProvider} onChangeText={setEditProvider} />
                <Text style={styles.modalLabel}>Confirmation</Text>
                <TextInput style={styles.input} editable={detailReady && mutationScope !== scope} value={editConfirmation} onChangeText={setEditConfirmation} />
                <Text style={styles.modalLabel}>Notes</Text>
                <TextInput style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]} multiline editable={detailReady && mutationScope !== scope} value={editNotes} onChangeText={setEditNotes} />
                <Text style={styles.modalLabel}>Assign to Trip</Text>
                {choices.map(choice => <TouchableOpacity key={choice.tripId} accessibilityRole="button" disabled={!detailReady || mutationScope === scope} style={[styles.navButton, { minHeight: 44 }]}
                  onPress={() => { setAssignTripId(choice.tripId); setSuggestionReasons(choice.reasons); }}>
                  <Text style={styles.navButtonText}>Suggestion: {choice.tripName || trips.find(trip => trip.id === choice.tripId)?.name || 'Trip'}</Text>
                  <Text style={styles.helperText}>{choice.reasons.join('. ')}</Text>
                </TouchableOpacity>)}
                {tripDraft && onCreateTripFromImport && <TouchableOpacity accessibilityRole="button" style={[styles.button, { minHeight: 44 }]} disabled={!detailReady || mutationScope === scope}
                  onPress={() => { editRequest.current += 1; setSelectedItem(null); onCreateTripFromImport(selectedItem.id, tripDraft); }}>
                  <Text style={styles.buttonText}>Create a trip from this booking</Text>
                </TouchableOpacity>}
                {trips.length === 0 ? (
                  <View>
                    <Text style={styles.helperText}>Create a trip first before assigning imported items.</Text>
                    <TouchableOpacity style={styles.button} onPress={() => onNavigate('create-trip')}>
                      <Text style={styles.buttonText}>Create Trip</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    {isAdmin && <TextInput style={styles.input} value={assignTripId} onChangeText={setAssignTripId} placeholder="Paste or select a trip id" />}
                    {suggestionReasons.length > 0 && <Text style={styles.helperText}>Suggested: {suggestionReasons.join(". ")}. Check the details before adding.</Text>}
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
                <TouchableOpacity style={styles.button} onPress={saveEdits} disabled={!detailReady || mutationScope === scope}>
                  <Text style={styles.buttonText}>Save Edits</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.button} onPress={assignItem} disabled={!assignTripId || !detailReady || mutationScope === scope}>
                  <Text style={styles.buttonText}>{assignTripId ? `Add to ${trips.find(trip => trip.id === assignTripId)?.name || 'selected trip'}` : 'Choose a trip'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, styles.tableActionButtonDanger]} onPress={() => deleteItem(selectedItem.id)}>
                  <Text style={styles.dangerButtonText}>Delete</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.button}
                  onPress={() => {
                    editRequest.current += 1; setSelectedItem(null);
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
