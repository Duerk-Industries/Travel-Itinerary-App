import IconText from './IconText';
import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useMemo, useState } from 'react';
import { Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Modal from './KeyboardAwareModal';
import { parseClipboardMatrix, serializeClipboardMatrix } from '../utils/clipboardGrid';
import { fixedTableColumn } from '../utils/tableColumns';
import DateField from './DateField';
import SelectField from './SelectField';


export type GridEditorKind = 'text' | 'date' | 'time' | 'decimal' | 'select' | 'singleSelect' | 'multiSelect' | 'textarea' | 'readonly' | 'action';

export type GridPickerOption = { id: string; label: string };

export type GridColumn<Row extends { id: string }> = {
  key: string;
  label: string;
  width: number;
  editor: GridEditorKind;
  /** Web-only frozen identity/control column placement. */
  sticky?: 'left' | 'right';
  editable?: boolean;
  sortable?: boolean;
  options?: readonly string[];
  /** Member selection choices for singleSelect and multiSelect editors. */
  pickerOptions?: readonly GridPickerOption[];
  /** Current member selection by id for singleSelect and multiSelect editors. */
  getSelectedIds?: (row: Row) => string[];
  getValue: (row: Row) => string;
  parseValue?: (value: string, row: Row) => { ok: true; value: unknown } | { ok: false; error: string };
};

export type GridCellError = { rowId: string; columnKey: string; message: string };

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
  theme?: AppTheme;
};

type CellPosition = { rowIndex: number; columnIndex: number };
type OpenPicker = { rowId: string; columnKey: string; kind: 'select' | 'multiSelect' };

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
  theme: _providedTheme,
}: EditableDataGridProps<Row>) {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [anchor, setAnchor] = useState<CellPosition | null>(null);
  const [active, setActive] = useState<CellPosition | null>(null);
  const [cutSelection, setCutSelection] = useState<Array<{ rowId: string; columnKey: string }>>([]);
  const [multiSelectDrafts, setMultiSelectDrafts] = useState<Record<string, string>>({});
  const [openPicker, setOpenPicker] = useState<OpenPicker | null>(null);
  const [pickerDraftIds, setPickerDraftIds] = useState<string[]>([]);

  // Style fallbacks are declared up front, before anything that renders a row, so
  // renderEditor/renderRows (invoked eagerly below while building `content`) never
  // reference a const ahead of its declaration.
  const selectedCellStyle = styles.selectedCell ?? themeStyle('components_EditableDataGrid_1', { theme: theme }, (theme ?? _styleTheme));
  const errorCellStyle = styles.errorCell ?? themeStyle('components_EditableDataGrid_2', { theme: theme }, (theme ?? _styleTheme));
  const deletedRowStyle = styles.deletedRow ?? themeStyle('components_EditableDataGrid_3', {  }, (theme ?? _styleTheme));
  const errorTextStyle = styles.errorText ?? themeStyle('components_EditableDataGrid_4', { theme: theme }, (theme ?? _styleTheme));
  const disabledButtonStyle = styles.disabledButton ?? themeStyle('components_EditableDataGrid_5', {  }, (theme ?? _styleTheme));
  const pickerButtonStyle = styles.gridPickerButton ?? themeStyle('components_EditableDataGrid_6', {  }, (theme ?? _styleTheme));
  const pickerLinkStyle = styles.gridPickerLink ?? themeStyle('components_EditableDataGrid_7', {  }, (theme ?? _styleTheme));
  const pickerLinkTextStyle = styles.linkText ?? themeStyle('components_EditableDataGrid_8', { theme: theme }, (theme ?? _styleTheme));
  const pickerOverlayStyle = styles.modalOverlay ?? themeStyle('components_EditableDataGrid_9', {  }, (theme ?? _styleTheme));
  const pickerCardStyle = styles.modalCard ?? themeStyle('components_EditableDataGrid_10', { theme: theme }, (theme ?? _styleTheme));
  const pickerOptionRowStyle = themeStyle('components_EditableDataGrid_11', {  }, (theme ?? _styleTheme));
  const stickyIdentityStyle = Platform.OS === 'web'
    ? (themeStyle('components_EditableDataGrid_12', { theme: theme }, (theme ?? _styleTheme)) as any)
    : null;
  const stickyActionsStyle = Platform.OS === 'web'
    ? (themeStyle('components_EditableDataGrid_13', { theme: theme }, (theme ?? _styleTheme)) as any)
    : null;
  const gridInputThemeStyle = themeStyle('components_EditableDataGrid_14', { theme: theme }, (theme ?? _styleTheme));
  const webInputStyle = themeStyle('components_EditableDataGrid_15', { gridInputThemeStyle: gridInputThemeStyle }, (theme ?? _styleTheme));

  const errorByCell = useMemo(() => new Map(cellErrors.map((error) => [cellKey(error.rowId, error.columnKey), error.message])), [cellErrors]);

  const selection = useMemo(() => {
    if (!anchor || !active) return null;
    return themeStyle('components_EditableDataGrid_16', { anchor: anchor, active: active }, (theme ?? _styleTheme));
  }, [anchor, active, _styleTheme]);

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
    const inputStyle = [styles.input, gridInputThemeStyle, themeStyle('components_EditableDataGrid_17', { column: column }, (theme ?? _styleTheme))];
    let editor: React.ReactNode;
    if (column.editor === 'singleSelect') {
      editor = <SelectField
        styles={styles} title={column.label} placeholder="Select payer" disabled={disabled}
        testID={`grid-${column.key}-${row.id}`}
        value={column.getSelectedIds?.(row)[0] ?? ''}
        options={[...(column.pickerOptions ?? [])].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true })).map(option => ({ value: option.id, label: option.label }))}
        onChange={id => { if (id) onChange(id); }}
      />;
    } else if (column.editor === 'select') {
      if (Platform.OS === 'web') {
        editor = React.createElement('select', { value, onChange: (event: { target: { value: string } }) => onChange(event.target.value), style: themeStyle('components_EditableDataGrid_18', { webInputStyle: webInputStyle, column: column }, (theme ?? _styleTheme)) }, (column.options ?? []).map((option) => React.createElement('option', { key: option, value: option }, option)));
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
      editor = (
        <DateField
          mode={column.editor}
          value={value}
          onChange={onChange}
          styles={styles}
          theme={theme}
          disabled={disabled}
          testID={`grid-${column.key}-${row.id}`}
          accessibilityLabel={column.label}
          style={[gridInputThemeStyle, themeStyle('components_EditableDataGrid_19', { column: column }, (theme ?? _styleTheme))]}
        />
      );
    } else if (column.editor === 'decimal') {
      if (Platform.OS === 'web') {
        editor = React.createElement('input', { type: 'number', value, onChange: (event: { target: { value: string } }) => onChange(event.target.value), style: themeStyle('components_EditableDataGrid_20', { webInputStyle: webInputStyle, column: column }, (theme ?? _styleTheme)) });
      } else {
        editor = <TextInput style={inputStyle} value={value} onChangeText={onChange} keyboardType="decimal-pad" placeholder="0.00" />;
      }
    } else if (column.editor === 'textarea') {
      editor = Platform.OS === 'web'
        ? React.createElement('textarea', { value, onChange: (event: { target: { value: string } }) => onChange(event.target.value), style: themeStyle('components_EditableDataGrid_21', { webInputStyle: webInputStyle, column: column }, (theme ?? _styleTheme)) })
        : <TextInput style={[inputStyle, themeStyle('components_EditableDataGrid_22', {  }, (theme ?? _styleTheme))]} value={value} onChangeText={onChange} multiline />;
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
            style: themeStyle('components_EditableDataGrid_23', { webInputStyle: webInputStyle, column: column }, (theme ?? _styleTheme)),
            placeholder: 'Name; Name',
          })
        : <TextInput style={inputStyle} value={multiSelectValue} onChangeText={onMultiSelectChange} onBlur={commitMultiSelect} onEndEditing={commitMultiSelect} placeholder="Name; Name" />;
      // A "Pick…" affordance is layered on top of the existing free-text entry (which
      // still supports typing/pasting semicolon-separated names) so the column is
      // discoverable on both platforms without removing the clipboard-paste path.
      editor = column.pickerOptions?.length ? (
        <View style={themeStyle('components_EditableDataGrid_24', { column: column }, (theme ?? _styleTheme))}>
          {textEditor}
          <TouchableOpacity disabled={disabled} style={pickerLinkStyle} onPress={() => openMultiSelectPicker(row, column)}>
            <Text style={pickerLinkTextStyle}>Pick…</Text>
          </TouchableOpacity>
        </View>
      ) : textEditor;
    } else {
      editor = Platform.OS === 'web'
        ? React.createElement('input', { value, onChange: (event: { target: { value: string } }) => onChange(event.target.value), style: themeStyle('components_EditableDataGrid_25', { webInputStyle: webInputStyle, column: column }, (theme ?? _styleTheme)) })
        : <TextInput style={inputStyle} value={value} onChangeText={onChange} />;
    }
    return (
      <View key={`${row.id}-${column.key}`} style={[styles.cell, fixedTableColumn(column.width), column.sticky === 'left' && stickyIdentityStyle, column.sticky === 'right' && stickyActionsStyle, selected && selectedCellStyle, error && errorCellStyle]}>
        {column.editor === 'readonly' ? <Text style={styles.cellText}>{value || '-'}</Text> : editor}
        {error ? <Text style={errorTextStyle}>{error}</Text> : null}
      </View>
    );
  };

  const renderRows = () => rows.map((row, rowIndex) => (
      <View key={row.id} style={[styles.tableRow, stagedDeleteIds.has(row.id) && deletedRowStyle]} testID={`activity-row-${row.id}`}>
      {columns.map((column, columnIndex) => {
        if (column.editor === 'action') {
          return <View key={`${row.id}-${column.key}`} style={[styles.cell, fixedTableColumn(column.width), styles.lastCell, stickyActionsStyle]}><TouchableOpacity disabled={disabled} style={[styles.button, styles.dangerButton, disabled && disabledButtonStyle]} onPress={() => onDeleteRow(row.id)}><Text style={styles.dangerButtonText}>{stagedDeleteIds.has(row.id) ? 'Restore' : 'Delete'}</Text></TouchableOpacity></View>;
        }
        return (
          <View
            key={`${row.id}-wrapper-${column.key}`}
            style={fixedTableColumn(column.width)}
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

  const header = <View style={[styles.tableRow, styles.tableHeader]} testID="activity-table-header">{columns.map((column, columnIndex) => {
    const isSortable = Boolean(onSort) && column.sortable !== false;
    const indicator = sortKey === column.key ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : '';
    const headerLabel = `${column.label}${indicator}`;
    return (
      <TouchableOpacity
        key={column.key}
        style={[styles.cell, fixedTableColumn(column.width), column.editor === 'action' && styles.lastCell, column.sticky === 'left' && stickyIdentityStyle, (column.sticky === 'right' || column.editor === 'action') && stickyActionsStyle]}
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
        <IconText style={styles.headerText}>{headerLabel}</IconText>
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
        style: themeStyle('components_EditableDataGrid_26', {  }, (theme ?? _styleTheme)),
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
              <TouchableOpacity style={[styles.button, themeStyle('components_EditableDataGrid_27', {  }, (theme ?? _styleTheme))]} onPress={closePicker}><Text style={styles.buttonText}>Cancel</Text></TouchableOpacity>
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
                    <IconText style={styles.cellText}>{checked ? '☑' : '☐'} {option.label}</IconText>
                  </TouchableOpacity>
                );
              })}
              <View style={themeStyle('components_EditableDataGrid_28', {  }, (theme ?? _styleTheme))}>
                <TouchableOpacity style={[styles.button, styles.dangerButton, themeStyle('components_EditableDataGrid_29', {  }, (theme ?? _styleTheme))]} onPress={closePicker}><Text style={styles.dangerButtonText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.button, themeStyle('components_EditableDataGrid_30', {  }, (theme ?? _styleTheme))]} onPress={commitMultiSelectPicker}><Text style={styles.buttonText}>Done</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

export default EditableDataGrid;
