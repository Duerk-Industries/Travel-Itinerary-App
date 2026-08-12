import React, { useMemo, useState } from 'react';
import { Modal, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { parseClipboardMatrix, serializeClipboardMatrix } from '../utils/clipboardGrid';

export type GridEditorKind = 'text' | 'date' | 'time' | 'decimal' | 'select' | 'multiSelect' | 'textarea' | 'readonly' | 'action';

export type GridPickerOption = { id: string; label: string };

export type GridColumn<Row extends { id: string }> = {
  key: string;
  label: string;
  width: number;
  editor: GridEditorKind;
  editable?: boolean;
  sortable?: boolean;
  options?: readonly string[];
  /** multiSelect only: the full set of choices offered by the "Pick…" picker modal. */
  pickerOptions?: readonly GridPickerOption[];
  /** multiSelect only: current selection by id, used to pre-check the picker modal. */
  getSelectedIds?: (row: Row) => string[];
  getValue: (row: Row) => string;
  parseValue?: (value: string, row: Row) => { ok: true; value: unknown } | { ok: false; error: string };
};

export type GridCellError = { rowId: string; columnKey: string; message: string };

type NativeDateTimePickerComponent = React.ComponentType<{
  value: Date;
  mode: 'date' | 'time';
  onChange: (event: unknown, date?: Date) => void;
}>;

export type EditableDataGridProps<Row extends { id: string }> = {
  rows: Row[];
  columns: GridColumn<Row>[];
  clipboardEnabled?: boolean;
  disabled?: boolean;
  cellErrors?: GridCellError[];
  stagedDeleteIds?: Set<string>;
  onCellChange: (rowId: string, columnKey: string, value: string) => void;
  onCellsChange?: (changes: Array<{ rowId: string; columnKey: string; value: string }>) => void;
  onDeleteRow: (rowId: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  sortKey?: string | null;
  sortDirection?: 'asc' | 'desc';
  onSort?: (columnKey: string) => void;
  onError?: (message: string) => void;
  styles?: Record<string, any>;
  theme?: { colors?: { text?: string; textMuted?: string; border?: string; surface?: string; link?: string; danger?: string } };
  /** Native-only: pass the app's existing @react-native-community/datetimepicker component
   * (the same one used elsewhere in the app) so grid date/time cells open a real native
   * picker instead of requiring hand-typed text. */
  nativeDateTimePicker?: NativeDateTimePickerComponent | null;
};

type CellPosition = { rowIndex: number; columnIndex: number };
type OpenPicker = { rowId: string; columnKey: string; kind: 'select' | 'multiSelect' | 'date' | 'time' };

const cellKey = (rowId: string, columnKey: string): string => `${rowId}:${columnKey}`;

// Native form controls (a focused <input>, <textarea>, or <select>) handle their own
// arrow-key text-cursor/option movement and their own per-character undo natively. The
// grid's own arrow-key cell navigation and Ctrl/Cmd+Z/Y shortcuts must not fight that —
// they only apply when keyboard focus is NOT inside one of these controls (e.g. the grid
// container itself, or a non-form-control cell such as a readonly column).
const isFormControlTarget = (target: unknown): boolean => {
  const tagName = (target as { tagName?: string } | undefined)?.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
};

const parseDateInputValue = (raw: string, mode: 'date' | 'time'): Date => {
  const base = new Date();
  if (mode === 'time') {
    if (raw && /^\d{1,2}:\d{2}/.test(raw)) {
      const [h, m] = raw.split(':').map(Number);
      if (!Number.isNaN(h) && !Number.isNaN(m)) base.setHours(h, m, 0, 0);
    }
    return base;
  }
  if (raw && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return base;
};

export function EditableDataGrid<Row extends { id: string }>({
  rows,
  columns,
  clipboardEnabled = false,
  disabled = false,
  cellErrors = [],
  stagedDeleteIds = new Set<string>(),
  onCellChange,
  onCellsChange,
  onDeleteRow,
  onUndo,
  onRedo,
  sortKey = null,
  sortDirection = 'asc',
  onSort,
  onError,
  styles = {},
  theme,
  nativeDateTimePicker = null,
}: EditableDataGridProps<Row>) {
  const [anchor, setAnchor] = useState<CellPosition | null>(null);
  const [active, setActive] = useState<CellPosition | null>(null);
  const [cutSelection, setCutSelection] = useState<Array<{ rowId: string; columnKey: string }>>([]);
  const [multiSelectDrafts, setMultiSelectDrafts] = useState<Record<string, string>>({});
  const [openPicker, setOpenPicker] = useState<OpenPicker | null>(null);
  const [pickerDraftIds, setPickerDraftIds] = useState<string[]>([]);
  const [pickerDraftDate, setPickerDraftDate] = useState<Date>(new Date());

  // Style fallbacks are declared up front, before anything that renders a row, so
  // renderEditor/renderRows (invoked eagerly below while building `content`) never
  // reference a const ahead of its declaration.
  const selectedCellStyle = styles.selectedCell ?? { backgroundColor: theme?.colors?.surface ?? '#eff6ff' };
  const errorCellStyle = styles.errorCell ?? { borderColor: theme?.colors?.danger ?? '#dc2626', borderWidth: 1 };
  const deletedRowStyle = styles.deletedRow ?? { opacity: 0.5 };
  const errorTextStyle = styles.errorText ?? { color: theme?.colors?.danger ?? '#dc2626', fontSize: 11 };
  const disabledButtonStyle = styles.disabledButton ?? { opacity: 0.45 };
  const pickerButtonStyle = styles.gridPickerButton ?? { justifyContent: 'center' };
  const pickerLinkStyle = styles.gridPickerLink ?? { marginHorizontal: 4, marginBottom: 4 };
  const pickerLinkTextStyle = styles.linkText ?? { color: theme?.colors?.link ?? '#2563eb', fontSize: 12 };
  const pickerOverlayStyle = styles.modalOverlay ?? { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,23,42,0.5)' };
  const pickerCardStyle = styles.modalCard ?? { backgroundColor: theme?.colors?.surface ?? '#fff', borderRadius: 12, padding: 16, minWidth: 260, maxHeight: '80%' };
  const pickerOptionRowStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 8 };
  const gridInputThemeStyle = {
    backgroundColor: theme?.colors?.surface ?? '#fff',
    color: theme?.colors?.text ?? '#111827',
    borderColor: theme?.colors?.border ?? '#ccd4df',
  };
  const webInputStyle = {
    ...gridInputThemeStyle,
    boxSizing: 'border-box' as const,
  };

  const errorByCell = useMemo(() => new Map(cellErrors.map((error) => [cellKey(error.rowId, error.columnKey), error.message])), [cellErrors]);

  const selection = useMemo(() => {
    if (!anchor || !active) return null;
    return {
      top: Math.min(anchor.rowIndex, active.rowIndex),
      bottom: Math.max(anchor.rowIndex, active.rowIndex),
      left: Math.min(anchor.columnIndex, active.columnIndex),
      right: Math.max(anchor.columnIndex, active.columnIndex),
    };
  }, [anchor, active]);

  const selectedCells = (): Array<{ row: Row; column: GridColumn<Row>; rowIndex: number; columnIndex: number }> => {
    if (!selection) return [];
    const result: Array<{ row: Row; column: GridColumn<Row>; rowIndex: number; columnIndex: number }> = [];
    for (let rowIndex = selection.top; rowIndex <= selection.bottom; rowIndex += 1) {
      for (let columnIndex = selection.left; columnIndex <= selection.right; columnIndex += 1) {
        const row = rows[rowIndex];
        const column = columns[columnIndex];
        if (row && column) result.push({ row, column, rowIndex, columnIndex });
      }
    }
    return result;
  };

  const copySelection = (event: { clipboardData?: { setData: (type: string, value: string) => void }; preventDefault: () => void }, isCut = false) => {
    if (!clipboardEnabled || disabled) return;
    const cells = selectedCells();
    if (!cells.length || cells.some((cell) => cell.column.editor === 'readonly' || cell.column.editor === 'action') || new Set(cells.map((cell) => cell.columnIndex)).size !== 1) {
      onError?.('Select cells in one column to copy or cut.');
      return;
    }
    const matrix = new Map<number, string[]>();
    cells.forEach(({ rowIndex, column, row }) => {
      const rowValues = matrix.get(rowIndex) ?? [];
      rowValues.push(column.getValue(row));
      matrix.set(rowIndex, rowValues);
    });
    const text = serializeClipboardMatrix(Array.from(matrix.values()));
    event.clipboardData?.setData('text/plain', text);
    setCutSelection(isCut ? cells.map(({ row, column }) => ({ rowId: row.id, columnKey: column.key })) : []);
    event.preventDefault();
  };

  const pasteSelection = (event: { clipboardData?: { getData: (type: string) => string }; preventDefault: () => void }) => {
    if (!clipboardEnabled || disabled || !active) return;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const parsed = parseClipboardMatrix(text);
    if (!parsed.ok) {
      onError?.(parsed.error);
      return;
    }
    const destinationColumn = columns[active.columnIndex];
    if (!destinationColumn || destinationColumn.editor === 'readonly' || destinationColumn.editor === 'action' || destinationColumn.editable === false) {
      onError?.('Select an editable column before pasting.');
      return;
    }
    const matrix = parsed.value;
    const targetRows = selection ? rows.slice(selection.top, selection.bottom + 1) : [rows[active.rowIndex]];
    if (matrix.length !== 1 && matrix.length !== targetRows.length) {
      onError?.('The pasted rows do not match the selected range.');
      return;
    }
    if (matrix.some((row) => row.length !== 1)) {
      onError?.('Paste into one column at a time.');
      return;
    }
    const changes: Array<{ rowId: string; columnKey: string; value: string }> = [];
    matrix.forEach((row, index) => {
      const target = targetRows[index] ?? targetRows[0];
      if (target) changes.push({ rowId: target.id, columnKey: destinationColumn.key, value: row[0] ?? '' });
    });
    if (cutSelection.length) {
      cutSelection.forEach((source) => {
        if (!changes.some((change) => change.rowId === source.rowId && change.columnKey === source.columnKey)) {
          changes.push({ rowId: source.rowId, columnKey: source.columnKey, value: '' });
        }
      });
      setCutSelection([]);
    }
    if (onCellsChange) onCellsChange(changes);
    else changes.forEach((change) => onCellChange(change.rowId, change.columnKey, change.value));
    event.preventDefault();
  };

  const handleKeyDown = (event: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; target?: unknown; preventDefault: () => void }) => {
    if (!active || disabled) return;
    if (isFormControlTarget(event.target)) return;
    const command = Boolean(event.ctrlKey || event.metaKey);
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) onRedo();
      else onUndo();
      return;
    }
    if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      onRedo();
      return;
    }
    let next = { ...active };
    if (event.key === 'ArrowDown') next.rowIndex = Math.min(rows.length - 1, active.rowIndex + 1);
    if (event.key === 'ArrowUp') next.rowIndex = Math.max(0, active.rowIndex - 1);
    if (event.key === 'ArrowRight') next.columnIndex = Math.min(columns.length - 1, active.columnIndex + 1);
    if (event.key === 'ArrowLeft') next.columnIndex = Math.max(0, active.columnIndex - 1);
    if (next.rowIndex !== active.rowIndex || next.columnIndex !== active.columnIndex) {
      event.preventDefault();
      setActive(next);
      if (!event.shiftKey) setAnchor(next);
    }
  };

  const openSelectPicker = (row: Row, column: GridColumn<Row>) => {
    if (disabled) return;
    setOpenPicker({ rowId: row.id, columnKey: column.key, kind: 'select' });
  };

  const openMultiSelectPicker = (row: Row, column: GridColumn<Row>) => {
    if (disabled) return;
    setPickerDraftIds(column.getSelectedIds ? column.getSelectedIds(row) : []);
    setOpenPicker({ rowId: row.id, columnKey: column.key, kind: 'multiSelect' });
  };

  const openDateTimePicker = (row: Row, column: GridColumn<Row>) => {
    if (disabled) return;
    setPickerDraftDate(parseDateInputValue(column.getValue(row), column.editor === 'time' ? 'time' : 'date'));
    setOpenPicker({ rowId: row.id, columnKey: column.key, kind: column.editor === 'time' ? 'time' : 'date' });
  };

  const closePicker = () => setOpenPicker(null);

  const openPickerColumn = openPicker ? columns.find((column) => column.key === openPicker.columnKey) : undefined;

  const commitMultiSelectPicker = () => {
    if (!openPicker || !openPickerColumn) return;
    const labels = (openPickerColumn.pickerOptions ?? [])
      .filter((option) => pickerDraftIds.includes(option.id))
      .map((option) => option.label)
      .join('; ');
    onCellChange(openPicker.rowId, openPicker.columnKey, labels);
    closePicker();
  };

  const commitSelectPicker = (option: string) => {
    if (!openPicker) return;
    onCellChange(openPicker.rowId, openPicker.columnKey, option);
    closePicker();
  };

  const commitDateTimePicker = (event: unknown, date?: Date) => {
    if (!openPicker) return;
    if (!date) {
      closePicker();
      return;
    }
    const value = openPicker.kind === 'time'
      ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
      : date.toISOString().slice(0, 10);
    onCellChange(openPicker.rowId, openPicker.columnKey, value);
    closePicker();
  };

  const renderEditor = (row: Row, column: GridColumn<Row>, rowIndex: number, columnIndex: number) => {
    const value = column.getValue(row);
    const key = cellKey(row.id, column.key);
    const multiSelectValue = multiSelectDrafts[key] ?? value;
    const error = errorByCell.get(cellKey(row.id, column.key));
    const selected = Boolean(selection && rowIndex >= selection.top && rowIndex <= selection.bottom && columnIndex >= selection.left && columnIndex <= selection.right);
    const onChange = (next: string) => {
      if (!disabled) onCellChange(row.id, column.key, next);
    };
    const onMultiSelectChange = (next: string) => {
      if (disabled) return;
      setMultiSelectDrafts((current) => ({ ...current, [key]: next }));
    };
    const commitMultiSelect = () => {
      if (disabled || !(key in multiSelectDrafts)) return;
      onCellChange(row.id, column.key, multiSelectDrafts[key]);
      setMultiSelectDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    };
    const inputStyle = [styles.input, gridInputThemeStyle, { minWidth: column.width - 16, width: column.width - 16, margin: 4 }];
    let editor: React.ReactNode;
    if (column.editor === 'select') {
      if (Platform.OS === 'web') {
        editor = React.createElement('select', { value, onChange: (event: { target: { value: string } }) => onChange(event.target.value), style: { ...webInputStyle, minWidth: column.width - 16, width: column.width - 16, margin: 4 } }, (column.options ?? []).map((option) => React.createElement('option', { key: option, value: option }, option)));
      } else {
        // Native gets the same picker affordance as the app's existing status/type
        // choosers elsewhere, instead of requiring the exact option text be typed.
        editor = (
          <TouchableOpacity disabled={disabled} style={[inputStyle, pickerButtonStyle]} onPress={() => openSelectPicker(row, column)}>
            <Text style={styles.cellText}>{value || 'Select…'}</Text>
          </TouchableOpacity>
        );
      }
    } else if (column.editor === 'date' || column.editor === 'time') {
      if (Platform.OS === 'web') {
        editor = React.createElement('input', { type: column.editor, value, onChange: (event: { target: { value: string } }) => onChange(event.target.value), style: { ...webInputStyle, minWidth: column.width - 16, width: column.width - 16, margin: 4 } });
      } else if (nativeDateTimePicker) {
        editor = (
          <TouchableOpacity disabled={disabled} style={[inputStyle, pickerButtonStyle]} onPress={() => openDateTimePicker(row, column)}>
            <Text style={styles.cellText}>{value || (column.editor === 'date' ? 'YYYY-MM-DD' : 'HH:mm')}</Text>
          </TouchableOpacity>
        );
      } else {
        editor = <TextInput style={inputStyle} value={value} onChangeText={onChange} placeholder={column.editor === 'date' ? 'YYYY-MM-DD' : 'HH:mm'} />;
      }
    } else if (column.editor === 'decimal') {
      if (Platform.OS === 'web') {
        editor = React.createElement('input', { type: 'number', value, onChange: (event: { target: { value: string } }) => onChange(event.target.value), style: { ...webInputStyle, minWidth: column.width - 16, width: column.width - 16, margin: 4 } });
      } else {
        editor = <TextInput style={inputStyle} value={value} onChangeText={onChange} keyboardType="decimal-pad" placeholder="0.00" />;
      }
    } else if (column.editor === 'textarea') {
      editor = Platform.OS === 'web'
        ? React.createElement('textarea', { value, onChange: (event: { target: { value: string } }) => onChange(event.target.value), style: { ...webInputStyle, minWidth: column.width - 16, width: column.width - 16, minHeight: 36, margin: 4 } })
        : <TextInput style={[inputStyle, { minHeight: 42 }]} value={value} onChangeText={onChange} multiline />;
    } else if (column.editor === 'multiSelect') {
      const textEditor = Platform.OS === 'web'
        ? React.createElement('input', {
            value: multiSelectValue,
            onChange: (event: { target: { value: string } }) => onMultiSelectChange(event.target.value),
            onBlur: commitMultiSelect,
            onKeyDown: (event: { key: string; preventDefault: () => void }) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitMultiSelect();
              }
            },
            style: { ...webInputStyle, minWidth: column.width - 16, width: column.width - 16, margin: 4 },
            placeholder: 'Name; Name',
          })
        : <TextInput style={inputStyle} value={multiSelectValue} onChangeText={onMultiSelectChange} onBlur={commitMultiSelect} onEndEditing={commitMultiSelect} placeholder="Name; Name" />;
      // A "Pick…" affordance is layered on top of the existing free-text entry (which
      // still supports typing/pasting semicolon-separated names) so the column is
      // discoverable on both platforms without removing the clipboard-paste path.
      editor = column.pickerOptions?.length ? (
        <View style={{ minWidth: column.width, width: column.width }}>
          {textEditor}
          <TouchableOpacity disabled={disabled} style={pickerLinkStyle} onPress={() => openMultiSelectPicker(row, column)}>
            <Text style={pickerLinkTextStyle}>Pick…</Text>
          </TouchableOpacity>
        </View>
      ) : textEditor;
    } else {
      editor = Platform.OS === 'web'
        ? React.createElement('input', { value, onChange: (event: { target: { value: string } }) => onChange(event.target.value), style: { ...webInputStyle, minWidth: column.width - 16, width: column.width - 16, margin: 4 } })
        : <TextInput style={inputStyle} value={value} onChangeText={onChange} />;
    }
    return (
      <View key={`${row.id}-${column.key}`} style={[styles.cell, { minWidth: column.width, width: column.width }, selected && selectedCellStyle, error && errorCellStyle]}>
        {column.editor === 'readonly' ? <Text style={styles.cellText}>{value || '-'}</Text> : editor}
        {error ? <Text style={errorTextStyle}>{error}</Text> : null}
      </View>
    );
  };

  const renderRows = () => rows.map((row, rowIndex) => (
    <View key={row.id} style={[styles.tableRow, stagedDeleteIds.has(row.id) && deletedRowStyle]} testID={`activity-row-${row.id}`}>
      {columns.map((column, columnIndex) => {
        if (column.editor === 'action') {
          return <View key={`${row.id}-${column.key}`} style={[styles.cell, { minWidth: column.width, width: column.width }, styles.lastCell]}><TouchableOpacity disabled={disabled} style={[styles.button, styles.dangerButton, disabled && disabledButtonStyle]} onPress={() => onDeleteRow(row.id)}><Text style={styles.dangerButtonText}>{stagedDeleteIds.has(row.id) ? 'Restore' : 'Delete'}</Text></TouchableOpacity></View>;
        }
        return (
          <View
            key={`${row.id}-wrapper-${column.key}`}
            onStartShouldSetResponder={() => true}
            onResponderGrant={() => {
              const next = { rowIndex, columnIndex };
              if (!active || !selection) setAnchor(next);
              setActive(next);
            }}
          >
            {renderEditor(row, column, rowIndex, columnIndex)}
          </View>
        );
      })}
    </View>
  ));

  const header = <View style={[styles.tableRow, styles.tableHeader]} testID="activity-table-header">{columns.map((column) => {
    const isSortable = Boolean(onSort) && column.sortable !== false;
    const indicator = sortKey === column.key ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : '';
    const headerLabel = `${column.label}${indicator}`;
    return (
      <TouchableOpacity
        key={column.key}
        style={[styles.cell, { minWidth: column.width, width: column.width }, column.editor === 'action' && styles.lastCell]}
        disabled={!isSortable}
        onPress={() => {
          setAnchor(null);
          setActive(null);
          onSort?.(column.key);
        }}
        accessible={isSortable}
        accessibilityRole={isSortable ? 'button' : undefined}
        accessibilityLabel={isSortable ? `Sort by ${column.label}` : column.label}
        testID={isSortable ? `activity-sort-${column.key}` : undefined}
      >
        <Text style={styles.headerText}>{headerLabel}</Text>
      </TouchableOpacity>
    );
  })}</View>;
  const content = <View style={styles.table}>{header}{renderRows()}</View>;
  const rootProps: Record<string, unknown> = Platform.OS === 'web'
    ? {
        tabIndex: 0,
        onKeyDown: handleKeyDown,
        onCopy: copySelection,
        onCut: (event: { clipboardData?: { setData: (type: string, value: string) => void }; preventDefault: () => void }) => copySelection(event, true),
        onPaste: pasteSelection,
        style: { outline: 'none' },
      }
    : {};

  return (
    <View>
      {Platform.OS === 'web' ? React.createElement('div', rootProps, content) : content}
      {openPicker?.kind === 'select' ? (
        <Modal transparent visible animationType="fade" onRequestClose={closePicker}>
          <View style={pickerOverlayStyle}>
            <View style={pickerCardStyle}>
              {(openPickerColumn?.options ?? []).map((option) => (
                <TouchableOpacity key={option} style={pickerOptionRowStyle} onPress={() => commitSelectPicker(option)}>
                  <Text style={styles.cellText}>{option}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={[styles.button, { marginTop: 12 }]} onPress={closePicker}><Text style={styles.buttonText}>Cancel</Text></TouchableOpacity>
            </View>
          </View>
        </Modal>
      ) : null}
      {openPicker?.kind === 'multiSelect' ? (
        <Modal transparent visible animationType="fade" onRequestClose={closePicker}>
          <View style={pickerOverlayStyle}>
            <View style={pickerCardStyle}>
              {(openPickerColumn?.pickerOptions ?? []).map((option) => {
                const checked = pickerDraftIds.includes(option.id);
                return (
                  <TouchableOpacity
                    key={option.id}
                    style={pickerOptionRowStyle}
                    onPress={() => setPickerDraftIds((current) => (checked ? current.filter((id) => id !== option.id) : [...current, option.id]))}
                  >
                    <Text style={styles.cellText}>{checked ? '☑' : '☐'} {option.label}</Text>
                  </TouchableOpacity>
                );
              })}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <TouchableOpacity style={[styles.button, styles.dangerButton, { flex: 1 }]} onPress={closePicker}><Text style={styles.dangerButtonText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={commitMultiSelectPicker}><Text style={styles.buttonText}>Done</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
      {(openPicker?.kind === 'date' || openPicker?.kind === 'time') && nativeDateTimePicker
        ? React.createElement(nativeDateTimePicker, { value: pickerDraftDate, mode: openPicker.kind, onChange: commitDateTimePicker })
        : null}
    </View>
  );
}

export default EditableDataGrid;
