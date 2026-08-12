
// @ts-nocheck
import React, { useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import HorizontalTableScroll from '../components/HorizontalTableScroll';
import { type Lodging, type LodgingDraft, buildLodgingPayload, createLodgingDraftForTrip, saveLodgingApi, removeLodgingApi } from './lodging';
import { formatUserDisplayName } from './overview';
import LodgingDialog from '../components/LodgingDialog';
import LodgingDetailsDialog from '../components/LodgingDetailsDialog';
import TripItemDetailsDialog from '../components/TripItemDetailsDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import { LEGACY_ITINERARY_STATUS, normalizeItineraryStatus } from '../utils/itineraryStatus';
import { formatNetVotes, shouldShowRatingButtons, shouldShowVoteButtons } from '../utils/votes';
import type { AppTheme } from '../theme/theme';
import EditableDataGrid, { type GridCellError, type GridColumn } from '../components/EditableDataGrid';
import { ITINERARY_STATUSES } from '../utils/itineraryStatus';

type LodgingTabProps = {
  backendUrl: string;
  jsonHeaders: Record<string, string>,
  requestHeaders: Record<string, string>,
  trip: { id: string, startDate?: string | null } | null;
  lodgings: Lodging[];
  groupMembers: any[];
  defaultPayerId: string | null;
  styles: Record<string, any>;
  onRefreshLodgings?: () => void;
  onOpenMap: (address: string) => void;
  formatMemberName: (member: any) => string; // This will be ignored, but kept for compatibility
  payerName: (id: string) => string;
  theme?: AppTheme;
  readOnly?: boolean;
  featureStandardizedItemDialogs?: boolean;
  // Kill switch for row-tap-to-edit + sticky identity/actions columns
  // (implementation-plan-ux-remediation.md, Initiative A). Defaults to `true`.
  featureTapToEditTables?: boolean;
};

export const formatShortDate = (dateString?: string | null): string => {
  if (!dateString) return '-';
  const hasDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateString);
  const target = hasDateOnly ? `${dateString}T00:00:00` : dateString;
  const parsed = new Date(target);
  if (Number.isNaN(parsed.getTime())) return dateString;
  const weekday = parsed.toLocaleDateString('en-US', { weekday: 'short' });
  const month = parsed.toLocaleDateString('en-US', { month: 'short' });
  const weekdayLabel = weekday.endsWith('.') ? weekday : `${weekday}.`;
  const monthLabel = month.endsWith('.') ? month : `${month}.`;
  return `${weekdayLabel} ${monthLabel} ${parsed.getDate()}`;
};

const LodgingTab: React.FC<LodgingTabProps> = ({
  backendUrl,
  jsonHeaders,
  requestHeaders,
  trip,
  lodgings,
  groupMembers,
  defaultPayerId,
  styles,
  onRefreshLodgings,
  onOpenMap,
  formatMemberName: _formatMemberName, // unused
  payerName: _payerName, // unused
  theme,
  readOnly = false,
  featureStandardizedItemDialogs = false,
  featureTapToEditTables = true,
}) => {
  const [selectedLodging, setSelectedLodging] = useState<Lodging | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editingLodging, setEditingLodging] = useState<Lodging | null>(null);
  const [lodgingDraft, setLodgingDraft] = useState<LodgingDraft | null>(null);
  const [lodgingToDelete, setLodgingToDelete] = useState<Lodging | null>(null);
  const [tableEditing, setTableEditing] = useState(false);
  const [gridRows, setGridRows] = useState<Lodging[]>([]);
  const [gridOriginalRows, setGridOriginalRows] = useState<Lodging[]>([]);
  const [gridDeleteIds, setGridDeleteIds] = useState<Set<string>>(new Set());
  const [gridHistory, setGridHistory] = useState<Array<{ rows: Lodging[]; deleteIds: string[] }>>([]);
  const [gridRedo, setGridRedo] = useState<Array<{ rows: Lodging[]; deleteIds: string[] }>>([]);
  const [gridErrors, setGridErrors] = useState<GridCellError[]>([]);
  const [gridMessage, setGridMessage] = useState<string | null>(null);
  const [gridSaving, setGridSaving] = useState(false);
  const [lodgingSort, setLodgingSort] = useState<{ key: string | null; direction: 'asc' | 'desc' }>({ key: null, direction: 'asc' });

  const activeTripId = trip?.id;

  const openAddDialog = () => {
    if (readOnly) return;
    if (!activeTripId) {
      Alert.alert('Please select a trip first.');
      return;
    }
    const draft = createLodgingDraftForTrip({
      tripStartDate: trip?.startDate,
      existingLodgings: lodgings,
      defaultPayerId: defaultPayerId,
      defaultTravelerIds: groupMembers.map((m) => m.id).filter(Boolean),
    });
    setLodgingDraft(draft);
    setEditingLodging(null);
    setShowEditor(true);
  };

  const openEditDialog = (lodging: Lodging) => {
    if (readOnly) return;
    const draft = {
      ...lodging,
      totalCost: lodging.totalCost?.toString() || '',
      costPerNight: lodging.costPerNight?.toString() || '',
      rooms: lodging.rooms?.toString() || '1',
    };
    setLodgingDraft(draft);
    setEditingLodging(lodging);
    setShowDetails(false);
    setShowEditor(true);
  };

  const openDetailsDialog = (lodging: Lodging) => {
    setSelectedLodging(lodging);
    setShowDetails(true);
  };

  const closeEditor = () => {
    setShowEditor(false);
    setEditingLodging(null);
    setLodgingDraft(null);
  };

  const closeDetails = () => {
    setShowDetails(false);
    setSelectedLodging(null);
  };

  const handleSave = async () => {
    if (readOnly) return;
    if (!lodgingDraft || !activeTripId) return;

    const { payload, error } = buildLodgingPayload(lodgingDraft, activeTripId, defaultPayerId);
    if (error || !payload) {
      Alert.alert(error || 'Failed to save lodging.');
      return;
    }

    const result = await saveLodgingApi(backendUrl, jsonHeaders, payload, editingLodging?.id);
    if (result.ok) {
      onRefreshLodgings?.();
      closeEditor();
    } else {
      Alert.alert(result.error || 'Failed to save lodging.');
    }
  };

  const handleDelete = async () => {
    if (readOnly) return;
    if (!lodgingToDelete) return;
    const target = lodgingToDelete;
    // Dismiss the confirmation/details surfaces before waiting on the delete request.
    setLodgingToDelete(null);
    closeDetails();
    const result = await removeLodgingApi(backendUrl, jsonHeaders, target.id);
    if (result.ok) {
      onRefreshLodgings?.();
    } else {
      Alert.alert(result.error || 'Failed to delete lodging.');
    }
  };

  const voteOnLodging = async (lodgingId: string, value: 1 | -1) => {
    if (readOnly) return;
    const res = await fetch(`${backendUrl}/api/lodgings/${lodgingId}/vote`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ value }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      Alert.alert(data.error || 'Unable to submit vote');
      return;
    }
    onRefreshLodgings?.();
  };

  const rateOnLodging = async (lodgingId: string, value: 1 | -1) => {
    if (readOnly) return;
    const res = await fetch(`${backendUrl}/api/lodgings/${lodgingId}/rating`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ value }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      Alert.alert(data.error || 'Unable to submit rating');
      return;
    }
    onRefreshLodgings?.();
  };
  
  const lodgingSortValue = (row: Lodging, key: string): string | number => {
    const value = (row as any)[key];
    if (key === 'netVotes' || key === 'netRating' || key === 'totalCost') return Number(value ?? 0) || 0;
    if (value === null || value === undefined) return '';
    return String(value);
  };
  const sortLodgingRows = (rows: Lodging[]) => {
    const key = lodgingSort.key ?? 'checkInDate';
    const direction = lodgingSort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = lodgingSortValue(a, key);
      const right = lodgingSortValue(b, key);
      if (left === '' && right !== '') return 1;
      if (right === '' && left !== '') return -1;
      const result = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right), undefined, { sensitivity: 'base', numeric: true });
      return result * direction;
    });
  };
  const sortedLodgings = useMemo(() => sortLodgingRows(lodgings), [lodgings, lodgingSort]);
  const sortedGridRows = useMemo(() => sortLodgingRows(gridRows), [gridRows, lodgingSort]);
  const sortLodgingTable = (key: string) => setLodgingSort((current) => current.key === key
    ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: 'asc' });

  const memberOptions = useMemo(() => groupMembers.map((member) => ({ id: member.id, label: formatUserDisplayName(member) })), [groupMembers]);
  const gridColumns = useMemo<GridColumn<Lodging>[]>(() => [
    { key: 'name', label: 'Name', width: 220, editor: 'text', sticky: 'left', getValue: (row) => row.name || '' },
    { key: 'checkInDate', label: 'Check-In', width: 140, editor: 'date', getValue: (row) => row.checkInDate || '' },
    { key: 'checkOutDate', label: 'Check-Out', width: 140, editor: 'date', getValue: (row) => row.checkOutDate || '' },
    { key: 'status', label: 'Status', width: 135, editor: 'select', options: ITINERARY_STATUSES, getValue: (row) => normalizeItineraryStatus(row.status, LEGACY_ITINERARY_STATUS) },
    { key: 'rooms', label: 'Rooms', width: 90, editor: 'decimal', getValue: (row) => String(row.rooms || '1') },
    { key: 'refundBy', label: 'Refund By', width: 140, editor: 'date', getValue: (row) => row.refundBy || '' },
    { key: 'totalCost', label: 'Total Cost', width: 115, editor: 'decimal', getValue: (row) => String(row.totalCost || '') },
    { key: 'address', label: 'Address', width: 230, editor: 'text', getValue: (row) => row.address || '' },
    { key: 'netVotes', label: 'Votes', width: 90, editor: 'readonly', editable: false, getValue: (row) => String(row.netVotes ?? 0) },
    { key: 'netRating', label: 'Rating', width: 90, editor: 'readonly', editable: false, getValue: (row) => String(row.netRating ?? 0) },
    { key: 'actions', label: 'Actions', width: 100, editor: 'action', sticky: 'right', editable: false, sortable: false, getValue: () => '' },
  ], []);

  const beginGridEdit = () => {
    if (readOnly) return;
    const snapshot = lodgings.map((row) => ({ ...row, paidBy: [...(row.paidBy ?? [])], travelerIds: [...(row.travelerIds ?? [])] }));
    setGridRows(snapshot); setGridOriginalRows(snapshot); setGridDeleteIds(new Set()); setGridHistory([]); setGridRedo([]); setGridErrors([]); setGridMessage(null); setTableEditing(true);
  };
  const cancelGridEdit = () => {
    setTableEditing(false); setGridRows([]); setGridOriginalRows([]); setGridDeleteIds(new Set()); setGridHistory([]); setGridRedo([]); setGridErrors([]); setGridMessage(null);
  };
  const recordGridChange = (rows: Lodging[], deleteIds: Set<string>) => {
    setGridHistory((items) => [...items.slice(-99), { rows: gridRows, deleteIds: Array.from(gridDeleteIds) }]);
    setGridRedo([]); setGridRows(rows); setGridDeleteIds(deleteIds);
  };
  const changeGridCell = (rowId: string, columnKey: string, rawValue: string) => {
    const column = gridColumns.find((item) => item.key === columnKey);
    const row = gridRows.find((item) => item.id === rowId);
    if (!row || !column || column.editor === 'readonly' || column.editor === 'action') return;
    if (column.editor === 'date' && rawValue && !/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) { setGridErrors([{ rowId, columnKey, message: 'Use YYYY-MM-DD.' }]); return; }
    if (column.editor === 'decimal' && rawValue && !/^\d*(\.\d*)?$/.test(rawValue)) { setGridErrors([{ rowId, columnKey, message: 'Enter a non-negative decimal.' }]); return; }
    if (column.editor === 'select' && !(column.options ?? []).includes(rawValue)) return;
    setGridErrors((errors) => errors.filter((error) => !(error.rowId === rowId && error.columnKey === columnKey)));
    recordGridChange(gridRows.map((item) => item.id === rowId ? { ...item, [columnKey]: rawValue } : item), new Set(gridDeleteIds));
  };
  const undoGridChange = () => { const previous = gridHistory.at(-1); if (!previous) return; setGridHistory((items) => items.slice(0, -1)); setGridRedo((items) => [...items, { rows: gridRows, deleteIds: Array.from(gridDeleteIds) }]); setGridRows(previous.rows); setGridDeleteIds(new Set(previous.deleteIds)); };
  const redoGridChange = () => { const next = gridRedo.at(-1); if (!next) return; setGridRedo((items) => items.slice(0, -1)); setGridHistory((items) => [...items, { rows: gridRows, deleteIds: Array.from(gridDeleteIds) }]); setGridRows(next.rows); setGridDeleteIds(new Set(next.deleteIds)); };
  const toggleGridDelete = (rowId: string) => { const next = new Set(gridDeleteIds); if (next.has(rowId)) next.delete(rowId); else next.add(rowId); recordGridChange(gridRows, next); };
  const saveGridEdit = async () => {
    if (gridSaving || gridErrors.length) { if (gridErrors.length) setGridMessage('Fix the highlighted cells before saving.'); return; }
    setGridSaving(true);
    try {
      const originalById = new Map(gridOriginalRows.map((row) => [row.id, row]));
      for (const row of gridRows) {
        if (gridDeleteIds.has(row.id)) {
          const result = await removeLodgingApi(backendUrl, jsonHeaders, row.id);
          if (!result.ok) throw new Error(result.error || 'Unable to delete lodging.');
          continue;
        }
        const original = originalById.get(row.id);
        if (original && JSON.stringify(original) !== JSON.stringify(row)) {
          const { payload, error } = buildLodgingPayload({ ...row, totalCost: String(row.totalCost || ''), costPerNight: String(row.costPerNight || '0'), rooms: String(row.rooms || '1') } as LodgingDraft, activeTripId, defaultPayerId);
          if (error || !payload) throw new Error(error || 'Unable to save lodging.');
          const result = await saveLodgingApi(backendUrl, jsonHeaders, payload, row.id);
          if (!result.ok) throw new Error(result.error || 'Unable to save lodging.');
        }
      }
      onRefreshLodgings?.();
      cancelGridEdit();
    } catch (error: any) { setGridMessage(error?.message || 'Unable to save lodging changes.'); }
    finally { setGridSaving(false); }
  };

  const travelerNames = useMemo(() => {
    const map = new Map<string, string>();
    groupMembers.forEach(member => {
      map.set(member.id, formatUserDisplayName(member));
    });
    return map;
  }, [groupMembers]);

  const payerName = (id: string) => travelerNames.get(id) ?? 'Unknown';
  const travelerName = (id: string) => travelerNames.get(id) ?? 'Unknown';

  return (
    <View style={[styles.card, { flex: 1, minHeight: 0 }]}>
      <View style={styles.row}>
        <Text style={styles.sectionTitle}>Lodging</Text>
        {!readOnly ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            {!tableEditing ? <TouchableOpacity style={[styles.button, styles.outlineButton]} onPress={beginGridEdit} testID="lodging-table-edit"><Text style={styles.buttonText}>Edit table</Text></TouchableOpacity> : null}
            {tableEditing ? <>
              <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={cancelGridEdit} disabled={gridSaving} testID="lodging-table-cancel"><Text style={styles.dangerButtonText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={saveGridEdit} disabled={gridSaving} testID="lodging-table-save"><Text style={styles.buttonText}>{gridSaving ? 'Saving…' : 'Save changes'}</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.button, { width: 36, height: 36, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }]} onPress={undoGridChange} disabled={gridSaving || !gridHistory.length} testID="lodging-table-undo"><Text style={styles.buttonText}>↶</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.button, { width: 36, height: 36, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }]} onPress={redoGridChange} disabled={gridSaving || !gridRedo.length} testID="lodging-table-redo"><Text style={styles.buttonText}>↷</Text></TouchableOpacity>
            </> : null}
            {!tableEditing ? <TouchableOpacity style={[styles.button, styles.roundButton]} onPress={openAddDialog} testID="lodging-add"><Text style={styles.buttonText}>+</Text></TouchableOpacity> : null}
          </View>
        ) : null}
      </View>
      {gridMessage ? <Text style={styles.helperText}>{gridMessage}</Text> : null}

      <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ flexGrow: 1 }}>
      {tableEditing ? <>
        <HorizontalTableScroll style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
          <EditableDataGrid rows={sortedGridRows} columns={gridColumns} disabled={gridSaving} cellErrors={gridErrors} stagedDeleteIds={gridDeleteIds} onCellChange={changeGridCell} onDeleteRow={toggleGridDelete} onUndo={undoGridChange} onRedo={redoGridChange} sortKey={lodgingSort.key} sortDirection={lodgingSort.direction} onSort={sortLodgingTable} styles={styles} theme={theme} />
        </HorizontalTableScroll>
      </> : null}
      {!tableEditing ? <>
        <HorizontalTableScroll
          style={styles.tableScroll}
          contentContainerStyle={styles.tableScrollContent}
          testID="lodging-table-horizontal-scroll"
          nestedScrollEnabled
          directionalLockEnabled
        >
        <View style={[styles.table, styles.lodgingTable, { minWidth: 878 }]}>
          <View style={[styles.tableRow, styles.tableHeaderRow]}>
            <TouchableOpacity style={[styles.tableHeaderCell, styles.lodgingTabNameCol, Platform.OS === 'web' && featureTapToEditTables && ({ position: 'sticky', left: 0, zIndex: 4, backgroundColor: theme?.colors.surface } as any)]} onPress={() => sortLodgingTable('name')}>
              <Text style={styles.headerText}>Name</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tableHeaderCell, styles.lodgingTabDateCol]} onPress={() => sortLodgingTable('checkInDate')}>
              <Text style={styles.headerText}>Check-In</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tableHeaderCell, styles.lodgingTabDateCol]} onPress={() => sortLodgingTable('checkOutDate')}>
              <Text style={styles.headerText}>Check-Out</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tableHeaderCell, styles.lodgingTabDateCol]} onPress={() => sortLodgingTable('status')}>
              <Text style={styles.headerText}>Status</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tableHeaderCell, styles.lodgingTabDateCol]} onPress={() => sortLodgingTable('netVotes')}>
              <Text style={styles.headerText}>Votes</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tableHeaderCell, styles.lodgingTabDateCol]} onPress={() => sortLodgingTable('netRating')}>
              <Text style={styles.headerText}>Rating</Text>
            </TouchableOpacity>
            <View style={[styles.tableHeaderCell, styles.lodgingTabActionsCol, styles.lastCell, Platform.OS === 'web' && featureTapToEditTables && ({ position: 'sticky', right: 0, zIndex: 4, backgroundColor: theme?.colors.surface } as any)]}>
              <Text style={styles.headerText}>Actions</Text>
            </View>
          </View>
          {sortedLodgings.map((lodging) => (
            <TouchableOpacity key={lodging.id} style={[styles.tableRow, styles.lodgingTableRow]} testID={`lodging-row-${lodging.id}`} onPress={() => { if (!readOnly && featureTapToEditTables) openEditDialog(lodging); }} activeOpacity={0.8}>
              <View style={[styles.tableCell, styles.lodgingTabNameCol, Platform.OS === 'web' && featureTapToEditTables && ({ position: 'sticky', left: 0, zIndex: 3, backgroundColor: theme?.colors.surface } as any)]}>
                <TouchableOpacity
                  style={styles.tableNameButton}
                  onPress={(event: any) => { event?.stopPropagation?.(); openDetailsDialog(lodging); }}
                >
                  <Text style={[styles.cellText, styles.cellTextWrap]}>{lodging.name}</Text>
                </TouchableOpacity>
              </View>
              <View style={[styles.tableCell, styles.lodgingTabDateCol]}>
                <Text style={styles.cellText}>{formatShortDate(lodging.checkInDate)}</Text>
              </View>
              <View style={[styles.tableCell, styles.lodgingTabDateCol]}>
                <Text style={styles.cellText}>{formatShortDate(lodging.checkOutDate)}</Text>
              </View>
              <View style={[styles.tableCell, styles.lodgingTabDateCol]}>
                <Text style={styles.cellText}>{normalizeItineraryStatus(lodging.status, LEGACY_ITINERARY_STATUS)}</Text>
              </View>
              <View style={[styles.tableCell, styles.lodgingTabDateCol]}>
                {!readOnly && shouldShowVoteButtons(lodging.status, (lodging as any).userVote) ? (
                  <View style={styles.actionCell}>
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => voteOnLodging(lodging.id, 1)}>
                      <Text style={styles.buttonText}>👍</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => voteOnLodging(lodging.id, -1)}>
                      <Text style={styles.buttonText}>👎</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.cellText}>{formatNetVotes((lodging as any).netVotes ?? 0)}</Text>
                )}
              </View>
              <View style={[styles.tableCell, styles.lodgingTabDateCol]}>
                {!readOnly && shouldShowRatingButtons(lodging.status, (lodging as any).userRating) ? (
                  <View style={styles.actionCell}>
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => rateOnLodging(lodging.id, 1)}>
                      <Text style={styles.buttonText}>👍</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => rateOnLodging(lodging.id, -1)}>
                      <Text style={styles.buttonText}>👎</Text>
                    </TouchableOpacity>
                  </View>
                ) : normalizeItineraryStatus(lodging.status, LEGACY_ITINERARY_STATUS) === 'Completed' ? (
                  <Text style={styles.cellText}>{formatNetVotes((lodging as any).netRating ?? 0)}</Text>
                ) : (
                  <Text style={styles.cellText}>-</Text>
                )}
              </View>
              <View style={[styles.tableCell, styles.lodgingTabActionsCol, styles.lastCell, Platform.OS === 'web' && featureTapToEditTables && ({ position: 'sticky', right: 0, zIndex: 3, backgroundColor: theme?.colors.surface } as any)]}>
                <View style={[styles.actionCell, { flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'flex-start' }]}>
                  {!readOnly ? (
                    <>
                      <TouchableOpacity
                        style={[styles.tableActionButton, styles.tableActionButtonPrimary]}
                        onPress={() => openEditDialog(lodging)}
                        testID={`lodging-edit-${lodging.id}`}
                      >
                        <Text style={styles.buttonText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.tableActionButton, styles.tableActionButtonDanger]}
                        onPress={() => setLodgingToDelete(lodging)}
                        testID={`lodging-delete-${lodging.id}`}
                      >
                        <Text style={styles.buttonText}>Delete</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <Text style={styles.cellText}>View only</Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
        </HorizontalTableScroll>
      </> : null}
      </ScrollView>

      {showDetails && selectedLodging && featureStandardizedItemDialogs ? (
        <TripItemDetailsDialog
          testID="lodging-details-dialog"
          visible
          kind="lodging"
          title={selectedLodging.name}
          status={normalizeItineraryStatus(selectedLodging.status, LEGACY_ITINERARY_STATUS)}
          rows={[
            { label: 'Check-in', value: formatShortDate(selectedLodging.checkInDate) },
            { label: 'Check-out', value: formatShortDate(selectedLodging.checkOutDate) },
            { label: 'Rooms', value: selectedLodging.rooms || '1' },
            { label: 'Refund by', value: formatShortDate(selectedLodging.refundBy) },
            { label: 'Address', value: selectedLodging.address || '-', onPress: selectedLodging.address ? () => onOpenMap(selectedLodging.address) : undefined },
            { label: 'Paid by', value: selectedLodging.paidBy?.length ? selectedLodging.paidBy.map(payerName).join(', ') : '-' },
            { label: 'Travelers', value: selectedLodging.travelerIds?.length ? selectedLodging.travelerIds.map(travelerName).join(', ') : '-' },
            { label: 'Total cost', value: selectedLodging.totalCost ? `$${selectedLodging.totalCost}` : '-' },
            { label: 'Cost per night', value: selectedLodging.costPerNight ? `$${selectedLodging.costPerNight}` : '-' },
            { label: 'Votes', value: formatNetVotes(selectedLodging.netVotes ?? 0) },
            { label: 'Rating', value: formatNetVotes(selectedLodging.netRating ?? 0) },
          ]}
          styles={styles}
          theme={theme}
          readOnly={readOnly}
          onClose={closeDetails}
          onEdit={() => openEditDialog(selectedLodging)}
          onDelete={() => setLodgingToDelete(selectedLodging)}
        />
      ) : null}
      {showDetails && selectedLodging && !featureStandardizedItemDialogs ? (
        <LodgingDetailsDialog
          testID="lodging-details-dialog"
          visible={showDetails}
          lodging={selectedLodging}
          backendUrl={backendUrl}
          requestHeaders={requestHeaders}
          styles={styles}
          theme={theme}
          payerName={payerName}
          travelerName={travelerName}
          readOnly={readOnly}
          onClose={closeDetails}
          onEdit={openEditDialog}
          onDelete={() => setLodgingToDelete(selectedLodging)}
          onOpenMap={onOpenMap}
        />
      ) : null}

      {showEditor && lodgingDraft && (
        <LodgingDialog
          testID="lodging-editor-dialog"
          visible={showEditor}
          title={editingLodging ? 'Lodging Details' : 'Add Lodging'}
          draft={lodgingDraft}
          setDraft={setLodgingDraft}
          groupMembers={groupMembers}
          formatMemberName={formatUserDisplayName}
          payerName={payerName}
          defaultPayerId={defaultPayerId}
          styles={styles}
          onSave={handleSave}
          onCancel={closeEditor}
        />
      )}

      {lodgingToDelete && (
          <ConfirmDialog
            testID="delete-lodging-dialog"
            visible
            title="Delete Lodging"
            message={`Are you sure you want to delete ${lodgingToDelete.name}?`}
            onCancel={() => setLodgingToDelete(null)}
            onConfirm={handleDelete}
            styles={styles}
        />
      )}
    </View>
  );
};

export default LodgingTab;
