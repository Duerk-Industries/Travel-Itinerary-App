import React, { useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Modal, Platform, Text, TouchableOpacity, View } from 'react-native';
import { mapColumns, ACTIVITY_HEADER_ALIASES, LODGING_HEADER_ALIASES, parseCsv, toActivityReviewRows, toCsv, toLodgingReviewRows, type ImportReviewRow } from '../utils/dataTransfer';
import { pickCsvFile, shareCsvFile } from '../utils/dataTransferPlatform';

type Props = {
  entity: 'activities' | 'lodgings';
  backendUrl: string;
  headers: Record<string, string>;
  tripId?: string | null;
  tripStart?: string | null;
  tripEnd?: string | null;
  rows: any[];
  styles: Record<string, any>;
  enabledImport?: boolean;
  enabledExport?: boolean;
  readOnly?: boolean;
  onImported?: () => void;
};

const fingerprint = (row: any, keys: string[]): string => JSON.stringify(keys.reduce<Record<string, unknown>>((out, key) => { out[key] = String(row[key] ?? '').trim().toLowerCase(); return out; }, {}));
const createImportId = (): string => {
  const cryptoApi = (globalThis as any).crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const CsvTransferControls: React.FC<Props> = ({ entity, backendUrl, headers, tripId, tripStart, tripEnd, rows, styles, enabledImport = false, enabledExport = false, readOnly = false, onImported }) => {
  const [reviewRows, setReviewRows] = useState<Array<ImportReviewRow<Record<string, unknown>>>>([]);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [modalVisible, setModalVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const importIdRef = useRef<string | null>(null);
  const definition = entity === 'activities' ? ACTIVITY_HEADER_ALIASES : LODGING_HEADER_ALIASES;
  const start = tripStart || new Date().toISOString().slice(0, 10);
  const end = tripEnd || start;
  const visibleRows = useMemo(() => reviewRows.filter((row) => !excluded.has(row.sourceRow)), [reviewRows, excluded]);
  const blockingRows = useMemo(() => visibleRows.filter((row) => row.errors.length > 0), [visibleRows]);

  const importCsv = async () => {
    if (!tripId) { Alert.alert('Select a trip first.'); return; }
    try {
      const picked = await pickCsvFile();
      if (!picked) return;
      const parsed = parseCsv(picked.text);
      if (parsed.issues.some((issue) => issue.severity === 'error')) { Alert.alert('Unable to import CSV', parsed.issues.slice(0, 4).map((issue) => issue.message).join('\n')); return; }
      const mapped = mapColumns(parsed.headers, definition);
      if (mapped.issues.length || mapped.unknown.length) {
        const detail = [...mapped.issues.map((issue) => issue.message), mapped.unknown.length ? `Ignored columns: ${mapped.unknown.join(', ')}` : ''].filter(Boolean).join('\n');
        if (mapped.issues.length) { Alert.alert('Review column mapping', detail); return; }
        Alert.alert('Review column mapping', detail, [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', onPress: () => openReview(parsed.rows, mapped.mapping) }]);
        return;
      }
      openReview(parsed.rows, mapped.mapping);
    } catch (error) { Alert.alert('Unable to import CSV', (error as Error).message); }
  };

  const openReview = (rawRows: Array<Record<string, string>>, mapping: Record<string, string>) => {
    const next = entity === 'activities' ? toActivityReviewRows(rawRows, mapping, start, end) : toLodgingReviewRows(rawRows, mapping, start, end);
    const currentIndex = new Map<string, any[]>();
    rows.forEach((row) => {
      const key = entity === 'activities' ? `${String(row.name ?? '').trim().toLowerCase()}|${row.date}|${row.startTime ?? ''}|${row.startLocation ?? ''}` : `${String(row.name ?? '').trim().toLowerCase()}|${row.checkInDate}|${row.checkOutDate}|${row.address ?? ''}`;
      const matches = currentIndex.get(key) ?? [];
      matches.push(row);
      currentIndex.set(key, matches);
    });
    next.forEach((review) => {
      const fields = review.fields;
      const key = entity === 'activities' ? `${String(fields.name ?? '').trim().toLowerCase()}|${fields.date}|${fields.startTime ?? ''}|${fields.startLocation ?? ''}` : `${String(fields.name ?? '').trim().toLowerCase()}|${fields.checkInDate}|${fields.checkOutDate}|${fields.address ?? ''}`;
      const matches = currentIndex.get(key) ?? [];
      const existing = matches.shift();
      if (matches.length) currentIndex.set(key, matches); else currentIndex.delete(key);
      if (existing) {
        review.action = 'skip';
        review.existingId = existing.id;
        review.expectedFingerprint = fingerprint(existing, entity === 'activities' ? ['name', 'date', 'startTime', 'startLocation', 'notes'] : ['name', 'checkInDate', 'checkOutDate', 'address', 'notes']);
        review.warnings.push({ severity: 'warning', message: 'Exact match found; row defaults to Skip.' });
      }
    });
    setReviewRows(next);
    setExcluded(new Set(next.filter((row) => row.action === 'skip').map((row) => row.sourceRow)));
    importIdRef.current = null;
    setModalVisible(true);
  };

  const commit = async () => {
    if (!tripId || !visibleRows.length) return;
    setBusy(true);
    try {
      const rowsToSend = visibleRows.map((row) => ({ sourceRow: row.sourceRow, action: row.action === 'update' || row.existingId ? 'update' : 'create', existingId: row.existingId, expectedFingerprint: row.expectedFingerprint, fields: row.fields }));
      const importId = importIdRef.current ?? createImportId();
      importIdRef.current = importId;
      const response = await fetch(`${backendUrl}/api/${entity}/import`, { method: 'POST', headers, body: JSON.stringify({ tripId, importId, rows: rowsToSend }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Import failed (${response.status}).`);
      setModalVisible(false);
      importIdRef.current = null;
      Alert.alert('Import complete', `${body.created ?? 0} created, ${body.updated ?? 0} updated, ${reviewRows.length - visibleRows.length} skipped.`);
      onImported?.();
    } catch (error) { Alert.alert('Import failed', (error as Error).message); } finally { setBusy(false); }
  };

  const exportCsv = async () => {
    if (!rows.length) { Alert.alert('There is no data to export.'); return; }
    const activityHeaders = ['WanderBunnies Record ID', 'WanderBunnies Record Fingerprint', 'Date', 'Activity Type', 'Start Time', 'Duration', 'Activity Name', 'Activity Notes', 'Activity Start Address', 'Status', 'Cost'];
    const lodgingHeaders = ['WanderBunnies Record ID', 'WanderBunnies Record Fingerprint', 'Check In', 'Check Out', 'Hotel', 'Booked?', 'Cancel By', 'Cost', 'Address', 'Notes', 'Features', 'Rooms'];
    const exportRows = entity === 'activities' ? rows.map((row) => ({ 'WanderBunnies Record ID': row.id, 'WanderBunnies Record Fingerprint': fingerprint(row, ['name', 'date', 'startTime', 'startLocation', 'notes']), Date: row.date, 'Activity Type': row.activityType, 'Start Time': row.startTime, Duration: row.duration, 'Activity Name': row.name, 'Activity Notes': row.notes, 'Activity Start Address': row.startLocation, Status: row.status, Cost: row.cost })) : rows.map((row) => ({ 'WanderBunnies Record ID': row.id, 'WanderBunnies Record Fingerprint': fingerprint(row, ['name', 'checkInDate', 'checkOutDate', 'address']), 'Check In': row.checkInDate, 'Check Out': row.checkOutDate, Hotel: row.name, 'Booked?': row.status === 'Booked' ? 'Yes' : 'No', 'Cancel By': row.refundBy, Cost: row.totalCost, Address: row.address, Notes: row.notes, Features: Array.isArray(row.features) ? row.features.join('; ') : '', Rooms: row.rooms }));
    try { await shareCsvFile(`${entity}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(entity === 'activities' ? activityHeaders : lodgingHeaders, exportRows)); } catch (error) { Alert.alert('Export failed', (error as Error).message); }
  };

  if ((!enabledImport || readOnly) && !enabledExport) return null;
  return <>
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      {enabledImport && !readOnly ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Import ${entity} CSV`} style={styles.button} onPress={importCsv} testID={`${entity}-import`}><Text style={styles.buttonText}>Import CSV</Text></TouchableOpacity> : null}
      {enabledExport ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Export ${entity} CSV`} style={styles.outlineButton ?? styles.button} onPress={exportCsv} testID={`${entity}-export`}><Text style={styles.buttonText}>Export CSV</Text></TouchableOpacity> : null}
    </View>
    <Modal visible={modalVisible} animationType="slide" onRequestClose={() => !busy && setModalVisible(false)}>
      <View style={{ flex: 1, padding: 16, paddingTop: Platform.OS === 'web' ? 16 : 48, backgroundColor: '#fff' }}>
        <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 8 }}>Review {entity}</Text>
        <Text style={{ marginBottom: 12 }}>{visibleRows.length} rows selected; {reviewRows.length - visibleRows.length} skipped.{blockingRows.length ? ` ${blockingRows.length} rows need correction or skipping.` : ''}</Text>
        <FlatList
          style={{ flex: 1 }}
          data={reviewRows}
          keyExtractor={(row) => String(row.sourceRow)}
          initialNumToRender={24}
          windowSize={8}
          removeClippedSubviews={Platform.OS !== 'web'}
          renderItem={({ item: row }) => <View style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: '#ddd', opacity: excluded.has(row.sourceRow) ? 0.5 : 1 }}><Text style={{ fontWeight: '600' }}>Source row {row.sourceRow}: {String(row.fields.name ?? '')}</Text><Text>{row.errors.length ? row.errors.map((issue) => issue.message).join(' ') : row.warnings.map((issue) => issue.message).join(' ') || 'Ready to import'}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel={`${excluded.has(row.sourceRow) ? 'Include' : 'Skip'} source row ${row.sourceRow}`} onPress={() => setExcluded((current) => { const next = new Set(current); if (next.has(row.sourceRow)) next.delete(row.sourceRow); else next.add(row.sourceRow); return next; })}><Text style={{ color: '#1769aa', marginTop: 6 }}>{excluded.has(row.sourceRow) ? 'Include row' : 'Skip row'}</Text></TouchableOpacity></View>}
        />
        <View style={{ flexDirection: 'row', gap: 10, paddingTop: 12 }}><TouchableOpacity style={styles.outlineButton ?? styles.button} onPress={() => setModalVisible(false)} disabled={busy}><Text style={styles.buttonText}>Cancel</Text></TouchableOpacity><TouchableOpacity style={styles.button} onPress={commit} disabled={busy || !visibleRows.length || blockingRows.length > 0}><Text style={styles.buttonText}>{busy ? 'Importing…' : 'Import selected'}</Text></TouchableOpacity></View>
      </View>
    </Modal>
  </>;
};

export default CsvTransferControls;
