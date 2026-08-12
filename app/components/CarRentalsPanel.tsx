import React from 'react';
import { Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import HorizontalTableScroll from './HorizontalTableScroll';
import { buildCarRentalFromDraft, createInitialCarRentalDraft, type CarRental, type CarRentalDraft } from '../tabs/carRentals';
import type { GroupMemberOption } from '../tabs/transfers';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import { toWebStyle } from '../utils/webStyle';
import {
  DEFAULT_NEW_ITINERARY_STATUS,
  ITINERARY_STATUSES,
  LEGACY_ITINERARY_STATUS,
  normalizeItineraryStatus,
} from '../utils/itineraryStatus';
import { formatNetVotes, shouldShowRatingButtons, shouldShowVoteButtons } from '../utils/votes';
import DraftTextInput from './DraftTextInput';
import DialogShell from './DialogShell';
import SelectField, { type SelectFieldOption } from './SelectField';
import EditableDataGrid, { type GridCellError, type GridColumn } from './EditableDataGrid';
import type { AppTheme } from '../theme/theme';

export type CarRentalsPanelProps = {
  /** Committed car-rental rows rendered in the table. */
  carRentals: CarRental[];
  /** Form draft for the "Add Car Rental" section. */
  carDraft: CarRentalDraft;
  setCarDraft: React.Dispatch<React.SetStateAction<CarRentalDraft>>;
  /** Prepaid dropdown visibility — lifted so the caller can coordinate with outside-click handling if needed. */
  carPrepaidOpen: boolean;
  setCarPrepaidOpen: React.Dispatch<React.SetStateAction<boolean>>;
  /** Refs into the native <input type=date> fields on web. Used to fire `.showPicker()`. */
  carPickupDateRef: React.RefObject<HTMLInputElement | null>;
  carDropoffDateRef: React.RefObject<HTMLInputElement | null>;
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
  /** Upvote/downvote a proposed rental (±1). */
  onVoteCarRental: (id: string, value: 1 | -1) => void | Promise<void>;
  /** Post-trip rating (±1). */
  onRateCarRental: (id: string, value: 1 | -1) => void | Promise<void>;
  /** Open the date picker for either pickup or drop-off. On web this fires `ref.showPicker()`; on native it toggles the NativeDateTimePicker that lives in the parent. */
  onOpenCarDatePicker: (field: 'pickup' | 'dropoff') => void;
  theme?: AppTheme;
  /** Kill switch for row-tap-to-edit + sticky identity/actions columns
   * (implementation-plan-ux-remediation.md, Initiative A). Defaults to `true`. */
  featureTapToEditTables?: boolean;
};

/**
 * Car Rentals panel — table of current rentals + an add-rental form. Lives
 * inside `renderSharedPageScroll` in App.tsx and was extracted verbatim as
 * part of the Priority 4 App.tsx decomposition. Presentational only: all
 * state lives in the parent and is pushed in via props. The native
 * DateTimePicker fallback (shown on iOS/Android when `Platform.OS !== 'web'`)
 * is intentionally NOT rendered here — it belongs to the parent component so
 * that the picker sits at the root of the trip screen and not nested inside
 * this panel's ScrollView.
 */
const CarRentalsPanel: React.FC<CarRentalsPanelProps> = ({
  carRentals,
  carDraft,
  setCarDraft,
  carPrepaidOpen: _carPrepaidOpen,
  setCarPrepaidOpen: _setCarPrepaidOpen,
  carPickupDateRef,
  carDropoffDateRef,
  isFollowingMode,
  userMembers,
  styles,
  payerName,
  formatMemberName,
  onAddCarRental,
  onUpdateCarRental,
  onRemoveCarRental,
  onVoteCarRental,
  onRateCarRental,
  onOpenCarDatePicker,
  theme,
  featureTapToEditTables = true,
}) => {
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
  const prepaidOptions: SelectFieldOption[] = [
    { label: 'Yes', value: 'Yes' },
    { label: 'No', value: 'No' },
  ];

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
  };

  const saveEditor = async () => {
    const saved = editingCarId ? await onUpdateCarRental(editingCarId) : await onAddCarRental();
    if (saved === false) return;
    setEditorOpen(false);
    setEditingCarId(null);
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
    { key: 'status', label: 'Status', width: 135, editor: 'select', options: [DEFAULT_NEW_ITINERARY_STATUS, 'Needed', 'Proposed', 'Booked', 'Completed', 'Cancelled'], getValue: (row) => normalizeItineraryStatus(row.status, LEGACY_ITINERARY_STATUS) },
    { key: 'vendor', label: 'Vendor', width: 150, editor: 'text', getValue: (row) => row.vendor || '' },
    { key: 'reference', label: 'Reference', width: 150, editor: 'text', getValue: (row) => row.reference || '' },
    { key: 'prepaid', label: 'Prepaid', width: 100, editor: 'select', options: ['Yes', 'No'], getValue: (row) => row.prepaid || '' },
    { key: 'cost', label: 'Cost', width: 110, editor: 'decimal', getValue: (row) => String(row.cost || '') },
    { key: 'model', label: 'Car Model', width: 150, editor: 'text', getValue: (row) => row.model || '' },
    { key: 'notes', label: 'Notes', width: 230, editor: 'textarea', getValue: (row) => row.notes || '' },
    { key: 'netVotes', label: 'Votes', width: 90, editor: 'readonly', editable: false, getValue: (row) => String(row.netVotes ?? 0) },
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

  const renderEditorFields = () => (
    <>
      <ScrollView style={styles.carEditorScroll ?? { maxHeight: 520 }} contentContainerStyle={styles.carEditorContent ?? { gap: 10 }}>
        <View style={styles.carFormGrid}>
          <DraftTextInput
            style={[styles.input, styles.carFormField]}
            placeholder="Pick up location"
            value={carDraft.pickupLocation}
            onChangeText={(text: string) => setCarDraft((p) => ({ ...p, pickupLocation: text }))}
            commitOnBlur={false}
          />
          <View style={[styles.dateInputWrap, styles.carFormField]}>
            {Platform.OS === 'web' ? (
              <input
                ref={carPickupDateRef as any}
                type="date"
                value={carDraft.pickupDate}
                onChange={(e) => setCarDraft((p) => ({ ...p, pickupDate: e.target.value }))}
                style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box', marginBottom: 0 })}
              />
            ) : (
              <TouchableOpacity
                style={[styles.input, styles.dateTouchable, { marginBottom: 0 }]}
                onPress={() => onOpenCarDatePicker('pickup')}
              >
                <Text style={styles.cellText}>{carDraft.pickupDate || 'YYYY-MM-DD'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.dateIcon} onPress={() => onOpenCarDatePicker('pickup')}>
              <Text style={styles.selectCaret}>📅</Text>
            </TouchableOpacity>
          </View>
          <DraftTextInput
            style={[styles.input, styles.carFormField]}
            placeholder="Drop off location"
            value={carDraft.dropoffLocation}
            onChangeText={(text: string) => setCarDraft((p) => ({ ...p, dropoffLocation: text }))}
            commitOnBlur={false}
          />
          <View style={[styles.dateInputWrap, styles.carFormField]}>
            {Platform.OS === 'web' ? (
              <input
                ref={carDropoffDateRef as any}
                type="date"
                value={carDraft.dropoffDate}
                onChange={(e) => setCarDraft((p) => ({ ...p, dropoffDate: e.target.value }))}
                style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box', marginBottom: 0 })}
              />
            ) : (
              <TouchableOpacity
                style={[styles.input, styles.dateTouchable, { marginBottom: 0 }]}
                onPress={() => onOpenCarDatePicker('dropoff')}
              >
                <Text style={styles.cellText}>{carDraft.dropoffDate || 'YYYY-MM-DD'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.dateIcon} onPress={() => onOpenCarDatePicker('dropoff')}>
              <Text style={styles.selectCaret}>📅</Text>
            </TouchableOpacity>
          </View>
          {Platform.OS === 'web' ? (
            <select
              value={normalizeItineraryStatus(carDraft.status, DEFAULT_NEW_ITINERARY_STATUS)}
              onChange={(e) => setCarDraft((p) => ({ ...p, status: normalizeItineraryStatus(e.target.value, DEFAULT_NEW_ITINERARY_STATUS) }))}
              style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box', marginBottom: 0 })}
            >
              {ITINERARY_STATUSES.map((opt) => (
                <option key={`car-status-${opt}`} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <Text style={styles.cellText}>{normalizeItineraryStatus(carDraft.status, DEFAULT_NEW_ITINERARY_STATUS)}</Text>
          )}
          <DraftTextInput
            style={[styles.input, styles.carFormField]}
            placeholder="Reference"
            value={carDraft.reference}
            onChangeText={(text: string) => setCarDraft((p) => ({ ...p, reference: text }))}
            commitOnBlur={false}
          />
          <DraftTextInput
            style={[styles.input, styles.carFormField]}
            placeholder="Vendor"
            value={carDraft.vendor}
            onChangeText={(text: string) => setCarDraft((p) => ({ ...p, vendor: text }))}
            commitOnBlur={false}
          />
          <SelectField
            styles={styles}
            options={prepaidOptions}
            value={carDraft.prepaid}
            placeholder="Prepaid? Select Yes or No"
            title="Prepaid status"
            style={styles.carFormField}
            webStyle={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box', marginBottom: 0 })}
            listStyle={styles.prepaidDropdownList}
            onChange={(value) => setCarDraft((p) => ({ ...p, prepaid: value }))}
          />
          <DraftTextInput
            style={[styles.input, styles.carFormField]}
            placeholder="Cost"
            keyboardType="numeric"
            value={carDraft.cost}
            onChangeText={(text: string) => setCarDraft((p) => ({ ...p, cost: sanitizeCostInput(text) }))}
            commitOnBlur={false}
          />
          <DraftTextInput
            style={[styles.input, styles.carFormField]}
            placeholder="Car model"
            value={carDraft.model}
            onChangeText={(text: string) => setCarDraft((p) => ({ ...p, model: text }))}
            commitOnBlur={false}
          />
          <DraftTextInput
            style={[styles.input, styles.carFormWideField, styles.cellTextWrap]}
            placeholder="Notes"
            value={carDraft.notes}
            onChangeText={(text: string) => setCarDraft((p) => ({ ...p, notes: text }))}
            commitOnBlur={false}
            multiline
          />
        </View>
        <View style={styles.carMemberRow}>
          <View style={[styles.carMemberField, { flex: 1 }]}>
            <Text style={styles.modalLabelSmall}>For</Text>
            <View style={styles.payerChips}>
              {carDraft.travelerIds.map((id) => (
                <View key={`car-traveler-${id}`} style={styles.payerChip}>
                  <Text style={styles.cellText}>{payerName(id)}</Text>
                  <TouchableOpacity onPress={() => setCarDraft((prev) => ({ ...prev, travelerIds: prev.travelerIds.filter((x) => x !== id) }))}>
                    <Text style={styles.removeText}>x</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
            <View style={styles.payerOptions}>
              {userMembers
                .filter((m) => !carDraft.travelerIds.includes(m.id))
                .map((m) => (
                  <TouchableOpacity
                    key={`car-traveler-add-${m.id}`}
                    style={styles.smallButton}
                    onPress={() =>
                      setCarDraft((prev) => ({
                        ...prev,
                        travelerIds: [...prev.travelerIds, m.id],
                      }))
                    }
                  >
                    <Text style={styles.buttonText}>Add {formatMemberName(m)}</Text>
                  </TouchableOpacity>
                ))}
            </View>
          </View>
          <View style={[styles.carMemberField, { flex: 1 }]}>
            <Text style={styles.modalLabelSmall}>Paid By</Text>
            <View style={styles.payerChips}>
              {carDraft.paidBy.map((id) => (
                <View key={id} style={styles.payerChip}>
                  <Text style={styles.cellText}>{payerName(id)}</Text>
                  <TouchableOpacity onPress={() => setCarDraft((prev) => ({ ...prev, paidBy: prev.paidBy.filter((x) => x !== id) }))}>
                    <Text style={styles.removeText}>x</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
            <View style={styles.payerOptions}>
              {userMembers
                .filter((m) => !carDraft.paidBy.includes(m.id))
                .map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    style={styles.smallButton}
                    onPress={() => setCarDraft((prev) => ({ ...prev, paidBy: [...prev.paidBy, m.id] }))}
                  >
                    <Text style={styles.buttonText}>Add {formatMemberName(m)}</Text>
                  </TouchableOpacity>
                ))}
            </View>
          </View>
        </View>
      </ScrollView>
      <View style={styles.tableFooter ?? styles.carMemberRow}>
        <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={closeEditor} testID="car-rental-cancel">
          <Text style={styles.dangerButtonText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.carAddButton]} onPress={saveEditor} testID="car-rental-save">
          <Text style={styles.buttonText}>Save</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  return (
    <View style={styles.card} testID="car-rentals-panel">
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Car Rentals</Text>
        {!isFollowingMode ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            {!tableEditing ? <TouchableOpacity style={[styles.button, styles.outlineButton]} onPress={beginGridEdit} testID="car-rental-table-edit"><Text style={styles.buttonText}>Edit table</Text></TouchableOpacity> : null}
            {tableEditing ? <>
              <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={cancelGridEdit} disabled={gridSaving} testID="car-rental-table-cancel"><Text style={styles.dangerButtonText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={saveGridEdit} disabled={gridSaving} testID="car-rental-table-save"><Text style={styles.buttonText}>{gridSaving ? 'Saving…' : 'Save changes'}</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.button, { width: 36, height: 36, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }]} onPress={undoGridChange} disabled={gridSaving || !gridHistory.length} testID="car-rental-table-undo"><Text style={styles.buttonText}>↶</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.button, { width: 36, height: 36, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }]} onPress={redoGridChange} disabled={gridSaving || !gridRedo.length} testID="car-rental-table-redo"><Text style={styles.buttonText}>↷</Text></TouchableOpacity>
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
          <TouchableOpacity style={[styles.tableHeaderCell, { flex: 2, minWidth: 240 }, Platform.OS === 'web' && featureTapToEditTables && ({ position: 'sticky', left: 0, zIndex: 4, backgroundColor: theme?.colors.surface } as any)]} onPress={() => sortCarTable('pickupLocation')}>
            <Text style={styles.headerText}>Route</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tableHeaderCell, { minWidth: 120 }]} onPress={() => sortCarTable('pickupDate')}>
            <Text style={styles.headerText}>Pick-up</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tableHeaderCell, { minWidth: 120 }]} onPress={() => sortCarTable('dropoffDate')}>
            <Text style={styles.headerText}>Drop-off</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tableHeaderCell, { minWidth: 110 }]} onPress={() => sortCarTable('status')}>
            <Text style={styles.headerText}>Status</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tableHeaderCell, { minWidth: 110 }]} onPress={() => sortCarTable('netVotes')}>
            <Text style={styles.headerText}>Votes</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tableHeaderCell, { minWidth: 110 }]} onPress={() => sortCarTable('netRating')}>
            <Text style={styles.headerText}>Rating</Text>
          </TouchableOpacity>
          <View style={[styles.tableHeaderCell, { minWidth: 180 }, styles.lastCell, Platform.OS === 'web' && featureTapToEditTables && ({ position: 'sticky', right: 0, zIndex: 4, backgroundColor: theme?.colors.surface } as any)]}>
            <Text style={styles.headerText}>Actions</Text>
          </View>
        </View>

        {sortedCarRentals.map((car, idx, arr) => (
          <TouchableOpacity key={car.id} style={[styles.tableRow, idx === arr.length - 1 && styles.lastRow]} onPress={() => { if (!isFollowingMode && featureTapToEditTables) openEditDialog(car); }} activeOpacity={0.8}>
            <View style={[styles.tableCell, { flex: 2, minWidth: 240 }, Platform.OS === 'web' && featureTapToEditTables && ({ position: 'sticky', left: 0, zIndex: 3, backgroundColor: theme?.colors.surface } as any)]}>
              <Text style={styles.cellText}>
                {`${car.pickupLocation || 'Pickup'} → ${car.dropoffLocation || 'Drop-off'}`}
              </Text>
              {(car.vendor || car.model || car.reference) ? (
                <Text style={styles.helperText}>
                  {[car.vendor, car.model, car.reference].filter(Boolean).join(' • ')}
                </Text>
              ) : null}
            </View>
            <View style={[styles.tableCell, { minWidth: 120 }]}>
              <Text style={styles.cellText}>{car.pickupDate || '-'}</Text>
            </View>
            <View style={[styles.tableCell, { minWidth: 120 }]}>
              <Text style={styles.cellText}>{car.dropoffDate || '-'}</Text>
            </View>
            <View style={[styles.tableCell, { minWidth: 110 }]}>
              <Text style={styles.cellText}>
                {normalizeItineraryStatus((car as any).status, LEGACY_ITINERARY_STATUS)}
              </Text>
            </View>
            <View style={[styles.tableCell, { minWidth: 110 }]}>
              <Text style={styles.cellText}>{formatNetVotes((car as any).netVotes ?? 0)}</Text>
            </View>
            <View style={[styles.tableCell, { minWidth: 110 }]}>
              {normalizeItineraryStatus((car as any).status, LEGACY_ITINERARY_STATUS) === 'Completed' ? (
                <Text style={styles.cellText}>{formatNetVotes((car as any).netRating ?? 0)}</Text>
              ) : (
                <Text style={styles.cellText}>-</Text>
              )}
            </View>
            <View style={[styles.tableCell, { minWidth: 180 }, styles.lastCell, Platform.OS === 'web' && featureTapToEditTables && ({ position: 'sticky', right: 0, zIndex: 3, backgroundColor: theme?.colors.surface } as any)]}>
              <View style={styles.actionCell}>
                {!isFollowingMode && shouldShowVoteButtons((car as any).status, (car as any).userVote) ? (
                  <>
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => onVoteCarRental(car.id, 1)}>
                      <Text style={styles.buttonText}>👍</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => onVoteCarRental(car.id, -1)}>
                      <Text style={styles.buttonText}>👎</Text>
                    </TouchableOpacity>
                  </>
                ) : null}
                {!isFollowingMode && shouldShowRatingButtons((car as any).status, (car as any).userRating) ? (
                  <>
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => onRateCarRental(car.id, 1)}>
                      <Text style={styles.buttonText}>⭐</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => onRateCarRental(car.id, -1)}>
                      <Text style={styles.buttonText}>✖</Text>
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

      <DialogShell
        visible={editorOpen}
        title={editingCarId ? 'Edit Car Rental' : 'Add Car Rental'}
        styles={styles}
        onClose={closeEditor}
        testID="car-rental-editor-dialog"
        useNativeModal
        cardStyle={[styles.confirmModal, styles.carEditorDialog]}
      >
        {renderEditorFields()}
      </DialogShell>
    </View>
  );
};

export default CarRentalsPanel;
