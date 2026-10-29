import { resolveComponentTheme as resolveStyleTheme, themeStyle, getAppTheme, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Platform, Text, TouchableOpacity, View } from 'react-native';
import Modal from './KeyboardAwareModal';
import { mapColumns, HEADER_ALIASES, EXPORT_HEADERS, fieldsForCommit, matchExistingRecords, parseCsv, toCsv, toExportRows, toReviewRows, type ImportReviewRow, type TransferEntity } from '../utils/dataTransfer';
import { pickCsvFile, shareCsvFile } from '../utils/dataTransferPlatform';
import { taskFailure, track, type TaskFailure } from '../utils/analytics/track';


type Props = {
  entity: TransferEntity;
  backendUrl: string;
  headers: Record<string, string>;
  tripId?: string | null;
  tripStart?: string | null;
  tripEnd?: string | null;
  rows: any[];
  styles: Record<string, any>;
  theme?: AppTheme;
  enabledImport?: boolean;
  enabledExport?: boolean;
  readOnly?: boolean;
  onImported?: () => void;
  renderActions?: (actions: { importCsv: () => void; exportCsv: () => void }) => React.ReactNode;
};

// What each entity is called in the UI, in analytics and in the API path.
const ENTITY_API_PATH: Record<TransferEntity, string> = {
  activities: '/api/activities/import',
  lodgings: '/api/lodgings/import',
  transfers: '/api/transfers/import',
  'car-rentals': '/api/car-rentals/import',
  'day-plan': '/api/itineraries/details/import',
};
const ENTITY_LABEL: Record<TransferEntity, string> = { activities: 'activities', lodgings: 'lodging', transfers: 'transfers', 'car-rentals': 'car rentals', 'day-plan': 'day plan' };
const ENTITY_FILE: Record<TransferEntity, string> = { activities: 'activities', lodgings: 'lodgings', transfers: 'transfers', 'car-rentals': 'car-rentals', 'day-plan': 'day-plan' };
const rowTitle = (row: ImportReviewRow<Record<string, unknown>>): string => String(row.fields.name ?? row.fields.title ?? row.fields.vendor ?? [row.fields.departureLocation, row.fields.arrivalLocation].filter(Boolean).join(' → '));
const createImportId = (): string => {
  const cryptoApi = (globalThis as any).crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const CsvTransferControls: React.FC<Props> = ({ entity, backendUrl, headers, tripId, tripStart, tripEnd, rows, styles, theme: _providedTheme, enabledImport = false, enabledExport = false, readOnly = false, onImported, renderActions }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const colors = (theme ?? getAppTheme('light', 'light')).colors;
  const [reviewRows, setReviewRows] = useState<Array<ImportReviewRow<Record<string, unknown>>>>([]);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [modalVisible, setModalVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const importIdRef = useRef<string | null>(null);
  const definition = HEADER_ALIASES[entity];
  const start0 = tripStart || null;
  const start = tripStart || new Date().toISOString().slice(0, 10);
  const end = tripEnd || start;
  const visibleRows = useMemo(() => reviewRows.filter((row) => !excluded.has(row.sourceRow)), [reviewRows, excluded]);
  const blockingRows = useMemo(() => visibleRows.filter((row) => row.errors.length > 0), [visibleRows]);

  const importTask = { task: 'import', feature: entity === 'activities' ? 'activities' : entity === 'lodgings' ? 'lodging' : entity } as const;
  const trackImport = (eventName: 'task_started' | 'task_cancelled') => track(eventName, importTask, { tripId });
  const trackImportFailed = (failure: TaskFailure) => track('task_failed', { ...importTask, failure }, { tripId });

  const cancelReview = () => {
    if (busy) return;
    setModalVisible(false);
    trackImport('task_cancelled');
  };

  const importCsv = async () => {
    if (!tripId) { Alert.alert('Select a trip first.'); return; }
    trackImport('task_started');
    try {
      const picked = await pickCsvFile();
      if (!picked) { trackImport('task_cancelled'); return; }
      const parsed = parseCsv(picked.text);
      if (parsed.issues.some((issue) => issue.severity === 'error')) { trackImportFailed('validation'); Alert.alert('Unable to import CSV', parsed.issues.slice(0, 4).map((issue) => issue.message).join('\n')); return; }
      const mapped = mapColumns(parsed.headers, definition);
      if (mapped.issues.length || mapped.unknown.length) {
        const detail = [...mapped.issues.map((issue) => issue.message), mapped.unknown.length ? `Ignored columns: ${mapped.unknown.join(', ')}` : ''].filter(Boolean).join('\n');
        if (mapped.issues.length) { trackImportFailed('validation'); Alert.alert('Review column mapping', detail); return; }
        Alert.alert('Review column mapping', detail, [{ text: 'Cancel', style: 'cancel', onPress: () => trackImport('task_cancelled') }, { text: 'Continue', onPress: () => openReview(parsed.rows, mapped.mapping) }]);
        return;
      }
      openReview(parsed.rows, mapped.mapping);
    } catch (error) { trackImportFailed('other'); Alert.alert('Unable to import CSV', (error as Error).message); }
  };

  const openReview = (rawRows: Array<Record<string, string>>, mapping: Record<string, string>) => {
    // A Record ID from this trip links a row to its record (unchanged rows skip, edited rows are
    // offered as an update); otherwise an exact key match defaults to Skip.
    const next = matchExistingRecords(entity, toReviewRows(entity, rawRows, mapping, start, end), rows, { tripStart: start });
    setReviewRows(next);
    setExcluded(new Set(next.filter((row) => row.action === 'skip').map((row) => row.sourceRow)));
    importIdRef.current = null;
    setModalVisible(true);
  };

  const commit = async () => {
    if (!tripId || !visibleRows.length) return;
    setBusy(true);
    let failureTracked = false;
    try {
      const rowsToSend = visibleRows.map((row) => ({ sourceRow: row.sourceRow, action: row.action === 'update' || row.existingId ? 'update' : 'create', existingId: row.existingId, expectedFingerprint: row.expectedFingerprint, fields: fieldsForCommit(row) }));
      const importId = importIdRef.current ?? createImportId();
      importIdRef.current = importId;
      const response = await fetch(`${backendUrl}${ENTITY_API_PATH[entity]}`, { method: 'POST', headers, body: JSON.stringify({ tripId, importId, rows: rowsToSend }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        trackImportFailed(taskFailure(response.status));
        failureTracked = true;
        throw new Error(body.error || `Import failed (${response.status}).`);
      }
      setModalVisible(false);
      importIdRef.current = null;
      Alert.alert('Import complete', `${body.created ?? 0} created, ${body.updated ?? 0} updated, ${reviewRows.length - visibleRows.length} skipped.`);
      onImported?.();
    } catch (error) {
      if (!failureTracked) trackImportFailed('network');
      Alert.alert('Import failed', (error as Error).message);
    } finally { setBusy(false); }
  };

  const exportCsv = async () => {
    if (!rows.length) { Alert.alert('There is no data to export.'); return; }
    const exportRows = toExportRows(entity, rows, { tripStart: start0 });
    if (!exportRows.length) { Alert.alert('There is no data to export.'); return; }
    try { await shareCsvFile(`${ENTITY_FILE[entity]}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(EXPORT_HEADERS[entity], exportRows)); } catch (error) { Alert.alert('Export failed', (error as Error).message); }
  };

  if (!renderActions && (!enabledImport || readOnly) && !enabledExport) return null;
  return <>
    {renderActions ? renderActions({ importCsv, exportCsv }) : <View style={themeStyle('components_CsvTransferControls_1', {  }, (theme ?? _styleTheme))}>
      {enabledImport && !readOnly ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Import ${entity} CSV`} style={styles.button} onPress={importCsv} testID={`${entity}-import`}><Text style={styles.buttonText}>Import CSV</Text></TouchableOpacity> : null}
      {enabledExport ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Export ${entity} CSV`} style={styles.outlineButton ?? styles.button} onPress={exportCsv} testID={`${entity}-export`}><Text style={styles.buttonText}>Export CSV</Text></TouchableOpacity> : null}
    </View>}
    <Modal visible={modalVisible} animationType="slide" onRequestClose={cancelReview}>
      <View style={themeStyle('components_CsvTransferControls_2', { Platform: Platform, colors: colors }, (theme ?? _styleTheme))}>
        <Text style={themeStyle('components_CsvTransferControls_3', { colors: colors }, (theme ?? _styleTheme))}>Review {ENTITY_LABEL[entity]}</Text>
        <Text style={themeStyle('components_CsvTransferControls_4', { colors: colors }, (theme ?? _styleTheme))}>{visibleRows.length} rows selected; {reviewRows.length - visibleRows.length} skipped.{blockingRows.length ? ` ${blockingRows.length} rows need correction or skipping.` : ''}</Text>
        <FlatList
          style={themeStyle('components_CsvTransferControls_5', {  }, (theme ?? _styleTheme))}
          data={reviewRows}
          keyExtractor={(row) => String(row.sourceRow)}
          initialNumToRender={24}
          windowSize={8}
          removeClippedSubviews={Platform.OS !== 'web'}
          renderItem={({ item: row }) => <View style={themeStyle('components_CsvTransferControls_6', { colors: colors, excluded: excluded, row: row }, (theme ?? _styleTheme))}><Text style={themeStyle('components_CsvTransferControls_7', { colors: colors }, (theme ?? _styleTheme))}>Source row {row.sourceRow}: {rowTitle(row)}</Text><Text style={themeStyle('components_CsvTransferControls_8', { colors: colors }, (theme ?? _styleTheme))}>{row.errors.length ? row.errors.map((issue) => issue.message).join(' ') : row.warnings.map((issue) => issue.message).join(' ') || 'Ready to import'}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel={`${excluded.has(row.sourceRow) ? 'Include' : 'Skip'} source row ${row.sourceRow}`} onPress={() => setExcluded((current) => { const next = new Set(current); if (next.has(row.sourceRow)) next.delete(row.sourceRow); else next.add(row.sourceRow); return next; })}><Text style={themeStyle('components_CsvTransferControls_9', { theme: theme, colors: colors }, (theme ?? _styleTheme))}>{excluded.has(row.sourceRow) ? 'Include row' : 'Skip row'}</Text></TouchableOpacity></View>}
        />
        <View style={themeStyle('components_CsvTransferControls_10', {  }, (theme ?? _styleTheme))}><TouchableOpacity style={[styles.outlineButton ?? styles.button, themeStyle('components_CsvTransferControls_11', {  }, (theme ?? _styleTheme))]} onPress={cancelReview} disabled={busy}><Text style={[styles.buttonText, themeStyle('components_CsvTransferControls_12', { styles: styles, colors: colors }, (theme ?? _styleTheme))]}>Cancel</Text></TouchableOpacity><TouchableOpacity style={[styles.button, themeStyle('components_CsvTransferControls_13', {  }, (theme ?? _styleTheme))]} onPress={commit} disabled={busy || !visibleRows.length || blockingRows.length > 0}><Text style={styles.buttonText}>{busy ? 'Importing…' : 'Import selected'}</Text></TouchableOpacity></View>
      </View>
    </Modal>
  </>;
};

export default CsvTransferControls;
