import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import AddToCalendarButton from './AddToCalendarButton';
import { rentalCalendarEvent } from '../utils/calendarEvents';
import React from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import HorizontalTableScroll from './HorizontalTableScroll';
import { buildCarRentalFromDraft, createInitialCarRentalDraft, type CarRental, type CarRentalDraft } from '../tabs/carRentals';
import type { GroupMemberOption } from '../tabs/transfers';
import {
  ITINERARY_STATUSES,
  DEFAULT_NEW_ITINERARY_STATUS,
  LEGACY_ITINERARY_STATUS,
  normalizeItineraryStatus,
} from '../utils/itineraryStatus';
import { formatNetVotes, shouldShowRatingButtons } from '../utils/votes';
import CarRentalEditForm from './CarRentalEditForm';
import EditableDataGrid, { type GridCellError, type GridColumn } from './EditableDataGrid';

import { fixedTableColumn } from '../utils/tableColumns';
import CsvTransferControls from './CsvTransferControls';

export type CarRentalsPanelProps = {
  /** Committed car-rental rows rendered in the table. */
  carRentals: CarRental[];
  /** Form draft for the "Add Car Rental" section. */
  carDraft: CarRentalDraft;
  setCarDraft: React.Dispatch<React.SetStateAction<CarRentalDraft>>;
  /** When true the form + action buttons are hidden (read-only follower view). */
  isFollowingMode: boolean;
  /** User-type (non-guest, non-removed) group members — feeds the For/Paid By chip lists. */
  userMembers: GroupMemberOption[];
  /** Full `styles` object from the parent App.tsx — the panel consumes ~30 named styles. */
  styles: Record<string, any>;
  /** Resolve a member-id to a printable name (falls back to "Unknown" at call site). */
  payerName: (id: string) => string;
  /** Formats a member's display name for the chip buttons. */
  formatMemberName: (member: GroupMemberOption) => string;
  /** Submit the current draft. Wired to the parent's `addCarRental`. */
  onAddCarRental: () => boolean | void | Promise<boolean | void>;
  /** Save the current draft over an existing car-rental row by id. */
  onUpdateCarRental: (id: string, draft?: CarRentalDraft) => boolean | void | Promise<boolean | void>;
  /** Delete a car-rental row by id. */
  onRemoveCarRental: (id: string) => void | Promise<void>;
  /** Post-trip rating (±1). */
  onRateCarRental: (id: string, value: 1 | -1) => void | Promise<void>;
  theme?: AppTheme;
  externalEditCarRentalId?: string | null;
  onExternalEditHandled?: () => void;
  showList?: boolean;
  /** Kill switch for row-tap-to-edit + sticky identity/actions columns
   * (implementation-plan-ux-remediation.md, Initiative A). Defaults to `true`. */
  featureTapToEditTables?: boolean;
  /** Car-rental CSV import/export. Omit (or leave both flags off) to hide the buttons. */
  csvTransfer?: {
    backendUrl: string;
    headers: Record<string, string>;
    tripId?: string | null;
    tripStart?: string | null;
    tripEnd?: string | null;
    enabledImport: boolean;
    enabledExport: boolean;
    onImported?: () => void;
  };
};

/**
 * Car Rentals panel — table of current rentals + an add-rental form. Lives
 * inside `renderSharedPageScroll` in App.tsx and was extracted verbatim as
 * part of the Priority 4 App.tsx decomposition. Presentational only: all
 * state lives in the parent and is pushed in via props. The add/edit dialog
 * itself is `CarRentalEditForm` (shared with the Overview day-detail quick
 * edit) and is fully self-contained, including its own native date-picker
 * fallback — it renders inside its own top-level `Modal`, so it isn't
 * affected by this panel's table ScrollView nesting.
 */
const CarRentalsPanel: React.FC<CarRentalsPanelProps> = ({
  carRentals,
  carDraft,
  setCarDraft,
  isFollowingMode,
  userMembers,
  styles,
  payerName,
  formatMemberName,
  onAddCarRental,
  onUpdateCarRental,
  onRemoveCarRental,
  onRateCarRental,
  theme: _providedTheme,
  externalEditCarRentalId,
  onExternalEditHandled,
  showList = true,
  featureTapToEditTables = true,
  csvTransfer,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingCarId, setEditingCarId] = React.useState<string | null>(null);
  const [tableEditing, setTableEditing] = React.useState(false);
  const [gridRows, setGridRows] = React.useState<CarRental[]>([]);
  const [gridOriginalRows, setGridOriginalRows] = React.useState<CarRental[]>([]);
  const [gridDeleteIds, setGridDeleteIds] = React.useState<Set<string>>(new Set());
  const [gridHistory, setGridHistory] = React.useState<Array<{ rows: CarRental[]; deleteIds: string[] }>>([]);
  const [gridRedo, setGridRedo] = React.useState<Array<{ rows: CarRental[]; deleteIds: string[] }>>([]);
  const [gridErrors, setGridErrors] = React.useState<GridCellError[]>([]);
  const [gridMessage, setGridMessage] = React.useState<string | null>(null);
  const [gridSaving, setGridSaving] = React.useState(false);
  const [carSort, setCarSort] = React.useState<{ key: string | null; direction: 'asc' | 'desc' }>({ key: null, direction: 'asc' });

  const openAddDialog = () => {
    setCarDraft(createInitialCarRentalDraft());
    setEditingCarId(null);
    setEditorOpen(true);
  };

  const openEditDialog = (car: CarRental) => {
    setCarDraft({
      status: normalizeItineraryStatus((car as any).status, DEFAULT_NEW_ITINERARY_STATUS),
      pickupLocation: car.pickupLocation ?? '',
      pickupDate: car.pickupDate ?? '',
      dropoffLocation: car.dropoffLocation ?? '',
      dropoffDate: car.dropoffDate ?? '',
      reference: car.reference ?? '',
      vendor: car.vendor ?? '',
      prepaid: car.prepaid ?? '',
      cost: String(car.cost ?? ''),
      model: car.model ?? '',
      notes: car.notes ?? '',
      paidBy: Array.isArray(car.paidBy) ? car.paidBy : [],
      travelerIds: Array.isArray(car.travelerIds) ? car.travelerIds : [],
    });
    setEditingCarId(car.id);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingCarId(null);
    setCarDraft(createInitialCarRentalDraft());
    onExternalEditHandled?.();
  };

  React.useEffect(() => {
    if (!externalEditCarRentalId) return;
    const target = carRentals.find((car) => car.id === externalEditCarRentalId);
    if (target) {
      openEditDialog(target);
    } else {
      onExternalEditHandled?.();
    }
  }, [externalEditCarRentalId, carRentals]);

  const saveEditor = async () => {
    const saved = editingCarId ? await onUpdateCarRental(editingCarId) : await onAddCarRental();
    if (saved === false) return;
    closeEditor();
  };

  const memberOptions = React.useMemo(() => userMembers.map((member) => ({ id: member.id, label: formatMemberName(member) })), [userMembers, formatMemberName]);
  const peopleText = (ids?: string[]) => (ids ?? []).map((id) => payerName(id) || id).join('; ');
  const sortCarRows = (rows: CarRental[]) => {
    const key = carSort.key ?? 'pickupDate';
    const direction = carSort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => String((a as any)[key] ?? '').localeCompare(String((b as any)[key] ?? ''), undefined, { sensitivity: 'base', numeric: true }) * direction);
  };
  const sortedCarRentals = React.useMemo(() => sortCarRows(carRentals), [carRentals, carSort]);
  const sortedGridRows = React.useMemo(() => sortCarRows(gridRows), [gridRows, carSort]);
  const sortCarTable = (key: string) => setCarSort((current) => current.key === key
    ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: 'asc' });
  const gridColumns = React.useMemo<GridColumn<CarRental>[]>(() => [
    { key: 'pickupLocation', label: 'Pick-up Location', width: 190, editor: 'text', sticky: 'left', getValue: (row) => row.pickupLocation || '' },
    { key: 'pickupDate', label: 'Pick-up', width: 135, editor: 'date', getValue: (row) => row.pickupDate || '' },
    { key: 'dropoffLocation', label: 'Drop-off Location', width: 190, editor: 'text', getValue: (row) => row.dropoffLocation || '' },
    { key: 'dropoffDate', label: 'Drop-off', width: 135, editor: 'date', getValue: (row) => row.dropoffDate || '' },
    { key: 'status', label: 'Status', width: 135, editor: 'select', options: ITINERARY_STATUSES, getValue: (row) => normalizeItineraryStatus(row.status, LEGACY_ITINERARY_STATUS) },
    { key: 'vendor', label: 'Vendor', width: 150, editor: 'text', getValue: (row) => row.vendor || '' },
    { key: 'reference', label: 'Reference', width: 150, editor: 'text', getValue: (row) => row.reference || '' },
    { key: 'prepaid', label: 'Prepaid', width: 100, editor: 'select', options: ['Yes', 'No'], getValue: (row) => row.prepaid || '' },
    { key: 'cost', label: 'Cost', width: 110, editor: 'decimal', getValue: (row) => String(row.cost || '') },
    { key: 'model', label: 'Car Model', width: 150, editor: 'text', getValue: (row) => row.model || '' },
    { key: 'notes', label: 'Notes', width: 230, editor: 'textarea', getValue: (row) => row.notes || '' },
    { key: 'netRating', label: 'Rating', width: 90, editor: 'readonly', editable: false, getValue: (row) => String(row.netRating ?? 0) },
    { key: 'actions', label: 'Actions', width: 100, editor: 'action', sticky: 'right', editable: false, sortable: false, getValue: () => '' },
  ], []);
  const beginGridEdit = () => { if (isFollowingMode) return; const snapshot = carRentals.map((row) => ({ ...row, paidBy: [...(row.paidBy ?? [])], travelerIds: [...(row.travelerIds ?? [])] })); setGridRows(snapshot); setGridOriginalRows(snapshot); setGridDeleteIds(new Set()); setGridHistory([]); setGridRedo([]); setGridErrors([]); setGridMessage(null); setTableEditing(true); };
  const cancelGridEdit = () => { setTableEditing(false); setGridRows([]); setGridOriginalRows([]); setGridDeleteIds(new Set()); setGridHistory([]); setGridRedo([]); setGridErrors([]); setGridMessage(null); };
  const recordGridChange = (rows: CarRental[], deleteIds: Set<string>) => { setGridHistory((items) => [...items.slice(-99), { rows: gridRows, deleteIds: Array.from(gridDeleteIds) }]); setGridRedo([]); setGridRows(rows); setGridDeleteIds(deleteIds); };
  const changeGridCell = (rowId: string, columnKey: string, rawValue: string) => {
    const column = gridColumns.find((item) => item.key === columnKey);
    const row = gridRows.find((item) => item.id === rowId);
    if (!row || !column || column.editor === 'readonly' || column.editor === 'action') return;
    if (column.editor === 'date' && rawValue && !/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) { setGridErrors([{ rowId, columnKey, message: 'Use YYYY-MM-DD.' }]); return; }
    if (column.editor === 'decimal' && rawValue && !/^\d*(\.\d*)?$/.test(rawValue)) { setGridErrors([{ rowId, columnKey, message: 'Enter a non-negative decimal.' }]); return; }
    setGridErrors((errors) => errors.filter((error) => !(error.rowId === rowId && error.columnKey === columnKey)));
    const value: any = columnKey === 'cost' ? rawValue : rawValue;
    recordGridChange(gridRows.map((item) => item.id === rowId ? { ...item, [columnKey]: value } : item), new Set(gridDeleteIds));
  };
  const undoGridChange = () => { const previous = gridHistory[gridHistory.length - 1]; if (!previous) return; setGridHistory((items) => items.slice(0, -1)); setGridRedo((items) => [...items, { rows: gridRows, deleteIds: Array.from(gridDeleteIds) }]); setGridRows(previous.rows); setGridDeleteIds(new Set(previous.deleteIds)); };
  const redoGridChange = () => { const next = gridRedo[gridRedo.length - 1]; if (!next) return; setGridRedo((items) => items.slice(0, -1)); setGridHistory((items) => [...items, { rows: gridRows, deleteIds: Array.from(gridDeleteIds) }]); setGridRows(next.rows); setGridDeleteIds(new Set(next.deleteIds)); };
  const toggleGridDelete = (rowId: string) => { const next = new Set(gridDeleteIds); if (next.has(rowId)) next.delete(rowId); else next.add(rowId); recordGridChange(gridRows, next); };
  const saveGridEdit = async () => {
    if (gridSaving || gridErrors.length) { if (gridErrors.length) setGridMessage('Fix the highlighted cells before saving.'); return; }
    setGridSaving(true);
    try {
      const originalById = new Map(gridOriginalRows.map((row) => [row.id, row]));
      for (const row of gridRows) {
        if (gridDeleteIds.has(row.id)) { await onRemoveCarRental(row.id); continue; }
        const original = originalById.get(row.id); if (!original || JSON.stringify(original) === JSON.stringify(row)) continue;
        const draft: CarRentalDraft = { status: normalizeItineraryStatus(row.status, DEFAULT_NEW_ITINERARY_STATUS), pickupLocation: row.pickupLocation || '', pickupDate: row.pickupDate || '', dropoffLocation: row.dropoffLocation || '', dropoffDate: row.dropoffDate || '', reference: row.reference || '', vendor: row.vendor || '', prepaid: row.prepaid || '', cost: String(row.cost || ''), model: row.model || '', notes: row.notes || '', paidBy: row.paidBy ?? [], travelerIds: row.travelerIds ?? [] };
        const result = await onUpdateCarRental(row.id, draft); if (result === false) throw new Error('Unable to save car rental.');
      }
      cancelGridEdit();
    } catch (error: any) { setGridMessage(error?.message || 'Unable to save car rental changes.'); }
    finally { setGridSaving(false); }
  };

  return (
    <View style={showList ? styles.card : undefined} testID="car-rentals-panel">
      {showList ? (
        <>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Car Rentals</Text>
        {csvTransfer && !tableEditing ? (
          <CsvTransferControls entity="car-rentals" backendUrl={csvTransfer.backendUrl} headers={csvTransfer.headers} tripId={csvTransfer.tripId} tripStart={csvTransfer.tripStart} tripEnd={csvTransfer.tripEnd} rows={carRentals} styles={styles} theme={theme} enabledImport={csvTransfer.enabledImport} enabledExport={csvTransfer.enabledExport} readOnly={isFollowingMode} onImported={csvTransfer.onImported} />
        ) : null}
        {!isFollowingMode ? (
          <View style={themeStyle('components_CarRentalsPanel_1', {  }, (theme ?? _styleTheme))}>
            {!tableEditing ? <TouchableOpacity style={[styles.button, styles.outlineButton]} onPress={beginGridEdit} testID="car-rental-table-edit"><Text style={styles.buttonText}>Edit table</Text></TouchableOpacity> : null}
            {tableEditing ? <>
              <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={cancelGridEdit} disabled={gridSaving} testID="car-rental-table-cancel"><Text style={styles.dangerButtonText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={saveGridEdit} disabled={gridSaving} testID="car-rental-table-save"><Text style={styles.buttonText}>{gridSaving ? 'Saving…' : 'Save changes'}</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.button, themeStyle('components_CarRentalsPanel_2', {  }, (theme ?? _styleTheme))]} onPress={undoGridChange} disabled={gridSaving || !gridHistory.length} testID="car-rental-table-undo"><Text style={styles.buttonText}>↶</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.button, themeStyle('components_CarRentalsPanel_3', {  }, (theme ?? _styleTheme))]} onPress={redoGridChange} disabled={gridSaving || !gridRedo.length} testID="car-rental-table-redo"><Text style={styles.buttonText}>↷</Text></TouchableOpacity>
            </> : null}
            {!tableEditing ? <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={openAddDialog} testID="car-rental-add"><Text style={styles.buttonText}>+ Add Rental</Text></TouchableOpacity> : null}
          </View>
        ) : null}
      </View>
      {gridMessage ? <Text style={styles.helperText}>{gridMessage}</Text> : null}
      {tableEditing ? <HorizontalTableScroll style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
        <EditableDataGrid rows={sortedGridRows} columns={gridColumns} disabled={gridSaving} cellErrors={gridErrors} stagedDeleteIds={gridDeleteIds} onCellChange={changeGridCell} onDeleteRow={toggleGridDelete} onUndo={undoGridChange} onRedo={redoGridChange} sortKey={carSort.key} sortDirection={carSort.direction} onSort={sortCarTable} styles={styles} theme={theme} />
      </HorizontalTableScroll> : null}
      {!tableEditing ? <>
      <HorizontalTableScroll
        style={styles.tableScroll}
        contentContainerStyle={styles.tableScrollContent}
        testID="car-rentals-table-scroll"
      >
      <View style={styles.table} testID="car-rentals-table">
        <View style={[styles.tableRow, styles.tableHeaderRow]}>
          <TouchableOpacity style={[styles.tableHeaderCell, fixedTableColumn(240), Platform.OS === 'web' && featureTapToEditTables && (themeStyle('components_CarRentalsPanel_4', { theme: theme }, (theme ?? _styleTheme)) as any)]} onPress={() => sortCarTable('pickupLocation')}>
            <Text style={styles.headerText}>Route</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tableHeaderCell, fixedTableColumn(120)]} onPress={() => sortCarTable('pickupDate')}>
            <Text style={styles.headerText}>Pick-up</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tableHeaderCell, fixedTableColumn(120)]} onPress={() => sortCarTable('dropoffDate')}>
            <Text style={styles.headerText}>Drop-off</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tableHeaderCell, fixedTableColumn(110)]} onPress={() => sortCarTable('status')}>
            <Text style={styles.headerText}>Status</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.tableHeaderCell, fixedTableColumn(110)]} onPress={() => sortCarTable('netRating')}>
            <Text style={styles.headerText}>Rating</Text>
          </TouchableOpacity>
          <View style={[styles.tableHeaderCell, fixedTableColumn(180), styles.lastCell, Platform.OS === 'web' && featureTapToEditTables && (themeStyle('components_CarRentalsPanel_5', { theme: theme }, (theme ?? _styleTheme)) as any)]}>
            <Text style={styles.headerText}>Actions</Text>
          </View>
        </View>

        {sortedCarRentals.map((car, idx, arr) => (
          <TouchableOpacity key={car.id} style={[styles.tableRow, idx === arr.length - 1 && styles.lastRow]} onPress={() => { if (!isFollowingMode && featureTapToEditTables) openEditDialog(car); }} activeOpacity={0.8}>
            <View style={[styles.tableCell, fixedTableColumn(240), Platform.OS === 'web' && featureTapToEditTables && (themeStyle('components_CarRentalsPanel_6', { theme: theme }, (theme ?? _styleTheme)) as any)]}>
              <Text style={styles.cellText}>
                {`${car.pickupLocation || 'Pickup'} → ${car.dropoffLocation || 'Drop-off'}`}
              </Text>
              {(car.vendor || car.model || car.reference) ? (
                <Text style={styles.helperText}>
                  {[car.vendor, car.model, car.reference].filter(Boolean).join(' • ')}
                </Text>
              ) : null}
            </View>
            <View style={[styles.tableCell, fixedTableColumn(120)]}>
              <Text style={styles.cellText}>{car.pickupDate || '-'}</Text>
            </View>
            <View style={[styles.tableCell, fixedTableColumn(120)]}>
              <Text style={styles.cellText}>{car.dropoffDate || '-'}</Text>
            </View>
            <View style={[styles.tableCell, fixedTableColumn(110)]}>
              <Text style={styles.cellText}>
                {normalizeItineraryStatus((car as any).status, LEGACY_ITINERARY_STATUS)}
              </Text>
            </View>

            <View style={[styles.tableCell, fixedTableColumn(110)]}>
              {normalizeItineraryStatus((car as any).status, LEGACY_ITINERARY_STATUS) === 'Completed' ? (
                <Text style={styles.cellText}>{formatNetVotes((car as any).netRating ?? 0)}</Text>
              ) : (
                <Text style={styles.cellText}>-</Text>
              )}
            </View>
            <View style={[styles.tableCell, fixedTableColumn(180), styles.lastCell, Platform.OS === 'web' && featureTapToEditTables && (themeStyle('components_CarRentalsPanel_7', { theme: theme }, (theme ?? _styleTheme)) as any)]}>
              <View style={styles.actionCell}>
                <AddToCalendarButton event={rentalCalendarEvent(car)} styles={styles} />

                {!isFollowingMode && shouldShowRatingButtons((car as any).status, (car as any).userRating) ? (
                  <>
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => onRateCarRental(car.id, 1)}>
                      <Text style={styles.buttonText}>⭐</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => onRateCarRental(car.id, -1)}>
                      <Text style={styles.dangerButtonText}>✖</Text>
                    </TouchableOpacity>
                  </>
                ) : null}
                {!isFollowingMode ? (
                  <>
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => openEditDialog(car)} testID={`car-rental-edit-${car.id}`}>
                      <Text style={styles.buttonText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => onRemoveCarRental(car.id)} testID={`car-rental-delete-${car.id}`}>
                      <Text style={styles.dangerButtonText}>Delete</Text>
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
        </>
      ) : null}

      {editorOpen ? (
        <CarRentalEditForm
          draft={carDraft}
          onChange={setCarDraft}
          onSave={saveEditor}
          onCancel={closeEditor}
          isNew={!editingCarId}
          members={userMembers}
          styles={styles}
          theme={theme}
        />
      ) : null}
    </View>
  );
};

export default CarRentalsPanel;
