import React, { useMemo, useState } from 'react';
import { Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { parseClipboardMatrix, serializeClipboardMatrix } from '../utils/clipboardGrid';

export type GridEditorKind = 'text' | 'date' | 'time' | 'decimal' | 'select' | 'multiSelect' | 'textarea' | 'readonly' | 'action';

export type GridColumn<Row extends { id: string }> = {
  key: string;
  label: string;
  width: number;
  editor: GridEditorKind;
  editable?: boolean;
  options?: readonly string[];
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
  canUndo: boolean;
  canRedo: boolean;
  onError?: (message: string) => void;
  styles?: Record<string, any>;
  theme?: { colors?: { text?: string; textMuted?: string; border?: string; surface?: string; link?: string; danger?: string } };
};

type CellPosition = { rowIndex: number; columnIndex: number };

const samePosition = (a: CellPosition | null, b: CellPosition | null): boolean =>
  Boolean(a && b && a.rowIndex === b.rowIndex && a.columnIndex === b.columnIndex);

const cellKey = (rowId: string, columnKey: string): string => `${rowId}:${columnKey}`;

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
  canUndo,
  canRedo,
  onError,
  styles = {},
  theme,
}: EditableDataGridProps<Row>) {
  const [anchor, setAnchor] = useState<CellPosition | null>(null);
  const [active, setActive] = useState<CellPosition | null>(null);
  const [cutSelection, setCutSelection] = useState<Array<{ rowId: string; columnKey: string }>>([]);
  const errorByCell = useMemo(() => new Map(cellErrors.map((error) => [cellKey(error.rowId, error.columnKey), error.message])), [cellErrors]);
  const editableColumns = useMemo(
    () => columns.map((column, index) => ({ column, index })).filter(({ column }) => column.editable !== false && column.editor !== 'readonly' && column.editor !== 'action'),
    [columns],
  );

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
    const targetHeight = selection ? selection.bottom - selection.top + 1 : 1;
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

  const handleKeyDown = (event: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; preventDefault: () => void }) => {
    if (!active || disabled) return;
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

  const renderEditor = (row: Row, column: GridColumn<Row>, rowIndex: number, columnIndex: number) => {
    const value = column.getValue(row);
    const error = errorByCell.get(cellKey(row.id, column.key));
    const selected = Boolean(selection && rowIndex >= selection.top && rowIndex <= selection.bottom && columnIndex >= selection.left && columnIndex <= selection.right);
    const onChange = (next: string) => {
      if (!disabled) onCellChange(row.id, column.key, next);
    };
    const inputStyle = [styles.input, { minWidth: column.width - 16, width: column.width - 16, margin: 4 }];
    let editor: React.ReactNode;
    if (column.editor === 'select' && Platform.OS === 'web') {
      editor = React.createElement('select', { value, onChange: (event: { target: { value: string } }) => onChange(event.target.value), style: { minWidth: column.width - 16, width: column.width - 16, margin: 4 } }, (column.options ?? []).map((option) => React.createElement('option', { key: option, value: option }, option)));
    } else if (column.editor === 'date' || column.editor === 'time' || column.editor === 'decimal') {
      if (Platform.OS === 'web') {
        editor = React.createElement('input', { type: column.editor === 'decimal' ? 'number' : column.editor, value, onChange: (event: { target: { value: string } }) => onChange(event.target.value), style: { minWidth: column.width - 16, width: column.width - 16, margin: 4, boxSizing: 'border-box' } });
      } else {
        editor = <TextInput style={inputStyle} value={value} onChangeText={onChange} keyboardType={column.editor === 'decimal' ? 'decimal-pad' : 'default'} placeholder={column.editor === 'date' ? 'YYYY-MM-DD' : column.editor === 'time' ? 'HH:mm' : '0.00'} />;
      }
    } else if (column.editor === 'textarea') {
      editor = Platform.OS === 'web'
        ? React.createElement('textarea', { value, onChange: (event: { target: { value: string } }) => onChange(event.target.value), style: { minWidth: column.width - 16, width: column.width - 16, minHeight: 36, margin: 4, boxSizing: 'border-box' } })
        : <TextInput style={[inputStyle, { minHeight: 42 }]} value={value} onChangeText={onChange} multiline />;
    } else {
      editor = Platform.OS === 'web'
        ? React.createElement('input', { value, onChange: (event: { target: { value: string } }) => onChange(event.target.value), style: { minWidth: column.width - 16, width: column.width - 16, margin: 4, boxSizing: 'border-box' } })
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

  const header = <View style={[styles.tableRow, styles.tableHeader]} testID="activity-table-header">{columns.map((column) => <View key={column.key} style={[styles.cell, { minWidth: column.width, width: column.width }, column.editor === 'action' && styles.lastCell]}><Text style={styles.headerText}>{column.label}</Text></View>)}</View>;
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
  const gridToolbarStyle = styles.gridToolbar ?? { flexDirection: 'row', gap: 8, paddingBottom: 8 };
  const selectedCellStyle = styles.selectedCell ?? { backgroundColor: theme?.colors?.surface ?? '#eff6ff' };
  const errorCellStyle = styles.errorCell ?? { borderColor: theme?.colors?.danger ?? '#dc2626', borderWidth: 1 };
  const deletedRowStyle = styles.deletedRow ?? { opacity: 0.5 };
  const errorTextStyle = styles.errorText ?? { color: theme?.colors?.danger ?? '#dc2626', fontSize: 11 };
  const disabledButtonStyle = styles.disabledButton ?? { opacity: 0.45 };
  return (
    <View>
      <View style={gridToolbarStyle}>
        <TouchableOpacity style={[styles.button, (!canUndo || disabled) && disabledButtonStyle]} disabled={!canUndo || disabled} onPress={onUndo} accessibilityLabel="Undo activity table change"><Text style={styles.buttonText}>Undo</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.button, (!canRedo || disabled) && disabledButtonStyle]} disabled={!canRedo || disabled} onPress={onRedo} accessibilityLabel="Redo activity table change"><Text style={styles.buttonText}>Redo</Text></TouchableOpacity>
      </View>
      {Platform.OS === 'web' ? React.createElement('div', rootProps, content) : content}
    </View>
  );
}

export default EditableDataGrid;
