import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';
import HorizontalTableScroll from './HorizontalTableScroll';
import PackingListMatrix from './PackingListMatrix';
import { getAppTheme } from '../theme/theme';

export type PackingItem = {
  id: string;
  category: string;
  label: string;
  position: number;
  packedBy?: string[];
  isCategory?: boolean;
};

type Traveler = {
  id: string;
  name: string;
  email?: string | null;
};

type Props = {
  backendUrl: string;
  headers: Record<string, string>;
  tripId?: string | null;
  variant: 'trip' | 'user' | 'admin';
  title?: string;
  allowPrint?: boolean;
  printTitle?: string;
};

const endpointFor = (variant: Props['variant'], backendUrl: string, tripId?: string | null) => {
  if (variant === 'trip') return `${backendUrl}/api/trips/${tripId}/packing-list`;
  if (variant === 'admin') return `${backendUrl}/api/admin/packing-list-defaults`;
  return `${backendUrl}/api/account/packing-list`;
};

const createDraftItem = (position: number): PackingItem => ({
  id: `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  category: 'New items',
  label: '',
  position,
  packedBy: [],
});

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const buildPrintablePackingListHtml = (
  title: string,
  items: PackingItem[],
  travelers: Traveler[]
) => {
  const groups: Array<{ category: string; items: PackingItem[] }> = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last?.category === item.category) last.items.push(item);
    else groups.push({ category: item.category, items: [item] });
  }
  const travelerHeaders = travelers.map((traveler) => `<th>${escapeHtml(traveler.name)}</th>`).join('');
  const rows = groups
    .map((group) => {
      const categoryRow = `<tr class="category"><td colspan="${Math.max(1, travelers.length + 1)}">${escapeHtml(group.category)}</td></tr>`;
      const itemRows = group.items
        .map((item) => {
          const checks = travelers
            .map((traveler) => `<td class="check">${item.packedBy?.includes(traveler.id) ? '&#10003;' : ''}</td>`)
            .join('');
          return `<tr><td>${escapeHtml(item.label)}</td>${checks}</tr>`;
        })
        .join('');
      return `${categoryRow}${itemRows}`;
    })
    .join('');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: letter landscape; margin: 0.4in; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, sans-serif; color: #111827; margin: 0; font-size: 10px; }
    h1 { font-size: 16px; margin: 0 0 10px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; border: 1.5px solid #111827; }
    th, td { border: 1px solid #111827; padding: 4px 5px; text-align: left; vertical-align: middle; line-height: 1.2; }
    th { background: #F3F4F6; font-size: 8px; text-transform: uppercase; overflow-wrap: anywhere; }
    th:first-child, td:first-child { width: 34%; }
    .category td { background: #E5E7EB; font-weight: 700; padding: 5px; }
    .check { text-align: center; font-size: 12px; font-weight: 700; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    @media screen { body { padding: 24px; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <table>
    <thead><tr><th>Item</th>${travelerHeaders}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
};

const PackingListTable: React.FC<Props> = ({ backendUrl, headers, tripId, variant, title, allowPrint = false, printTitle }) => {
  const colorScheme = useColorScheme();
  const theme = getAppTheme('auto', colorScheme);
  const [items, setItems] = useState<PackingItem[]>([]);
  const [travelers, setTravelers] = useState<Traveler[]>([]);
  const [draftItems, setDraftItems] = useState<PackingItem[]>([]);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [v2, setV2] = useState(false);
  const [presets, setPresets] = useState<Array<{ key: string; label: string }>>([]);
  const [selectedPresetKeys, setSelectedPresetKeys] = useState<string[]>(['general']);
  const [tripPresetKeys, setTripPresetKeys] = useState<string[]>([]);
  const [currentTravelerId, setCurrentTravelerId] = useState<string | null>(null);

  const url = endpointFor(variant, backendUrl, tripId);
  const canLoad = variant !== 'trip' || Boolean(tripId);
  const isTrip = variant === 'trip';

  const orderedTravelers = useMemo(() => {
    if (!isTrip) return travelers;
    return [...travelers].sort((a, b) => {
      if (a.id === currentTravelerId) return -1;
      if (b.id === currentTravelerId) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [currentTravelerId, isTrip, travelers]);

  const applyResponse = (data: any) => {
    const hasGroups = Array.isArray(data.groups);
    setV2(hasGroups || data.preferences !== undefined || Array.isArray(data.tripPresetKeys));
    setPresets(Array.isArray(data.presets) ? data.presets : []);
    setSelectedPresetKeys(Array.isArray(data.preferences?.presetKeys) ? data.preferences.presetKeys : ['general']);
    setTripPresetKeys(Array.isArray(data.tripPresetKeys) ? data.tripPresetKeys : []);
    setCurrentTravelerId(typeof data.currentTravelerId === 'string' ? data.currentTravelerId : null);
    const nextItems = hasGroups
      ? data.groups.flatMap((group: any) => [
          { id: `category-${group.id}`, category: group.label, label: group.label, position: 0, isCategory: true },
          ...(group.items ?? []).map((item: PackingItem) => ({ ...item, category: group.label })),
        ])
      : (data.items ?? []).map((item: PackingItem, index: number) => ({ ...item, position: index }));
    setItems(nextItems);
    setDraftItems(hasGroups
      ? ((data.groups.find((group: any) => group.kind === 'trip_manual')?.items ?? []) as PackingItem[])
      : nextItems.filter((item: PackingItem) => !item.isCategory));
    setTravelers(data.travelers ?? []);
  };

  const load = useCallback(async () => {
    if (!canLoad) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Unable to load packing list');
      applyResponse(data);
    } catch (err: any) {
      setError(err.message ?? 'Unable to load packing list');
    } finally {
      setLoading(false);
    }
  }, [canLoad, headers, url]);

  useEffect(() => {
    void load();
  }, [load]);

  const groupedItems = useMemo(() => {
    const source = editMode ? draftItems : items;
    const groups: Array<{ category: string; items: PackingItem[] }> = [];
    for (const item of source) {
      const last = groups[groups.length - 1];
      if (last?.category === item.category) {
        last.items.push(item);
      } else {
        groups.push({ category: item.category, items: [item] });
      }
    }
    return groups;
  }, [draftItems, editMode, items]);

  const updateDraft = (id: string, patch: Partial<PackingItem>) => {
    setDraftItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const addDraftItem = () => {
    const item = createDraftItem(0);
    setPendingFocusId(item.id);
    setDraftItems((prev) => [item, ...prev].map((entry, pos) => ({ ...entry, position: pos })));
  };

  const moveDraft = (id: string, direction: -1 | 1) => {
    setDraftItems((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next.map((entry, pos) => ({ ...entry, position: pos }));
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = draftItems
        .map((item, index) => ({ ...item, position: index, category: item.category.trim(), label: item.label.trim() }))
        .filter((item) => item.category && item.label);
      const res = await fetch(url, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payload, preferences: { presetKeys: selectedPresetKeys }, reason: 'Updated packing list defaults' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Unable to save packing list');
      applyResponse(data);
      setEditMode(false);
    } catch (err: any) {
      setError(err.message ?? 'Unable to save packing list');
    } finally {
      setSaving(false);
    }
  };

  const addPreset = async (presetKey: string) => {
    if (!isTrip) {
      if (presetKey === 'general') return;
      setSelectedPresetKeys((previous) => previous.includes(presetKey) ? previous.filter((key) => key !== presetKey) : [...previous, presetKey]);
      setEditMode(true);
      return;
    }
    try {
      const res = await fetch(`${url}/presets`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ presetKey }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Unable to add preset');
      applyResponse(data);
    } catch (err: any) {
      setError(err.message ?? 'Unable to add preset');
    }
  };

  const removePreset = async (presetKey: string) => {
    try {
      const res = await fetch(`${url}/presets/${encodeURIComponent(presetKey)}`, { method: 'DELETE', headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Unable to remove preset');
      applyResponse(data);
    } catch (err: any) {
      setError(err.message ?? 'Unable to remove preset');
    }
  };

  const printList = () => {
    const printableTitle = printTitle ?? title ?? 'Packing list';
    const html = buildPrintablePackingListHtml(printableTitle, items, travelers);
    const webWindow = globalThis as typeof globalThis & {
      open?: (url?: string, target?: string) => { document?: { open: () => void; write: (html: string) => void; close: () => void }; focus?: () => void; print?: () => void } | null;
      print?: () => void;
    };
    const printWindow = webWindow.open?.('', '_blank');
    if (printWindow?.document) {
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus?.();
      printWindow.print?.();
      return;
    }
    if (typeof webWindow.print === 'function') {
      webWindow.print();
      return;
    }
    setError('Printing is available from a web browser.');
  };

  const togglePacked = async (item: PackingItem, traveler: Traveler) => {
    if (!isTrip || editMode) return;
    const currentlyPacked = item.packedBy?.includes(traveler.id) ?? false;
    setItems((prev) =>
      prev.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              packedBy: currentlyPacked
                ? (entry.packedBy ?? []).filter((id) => id !== traveler.id)
                : Array.from(new Set([...(entry.packedBy ?? []), traveler.id])),
            }
          : entry
      )
    );
    try {
      await fetch(`${url}/checks`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, travelerId: traveler.id, packed: !currentlyPacked }),
      });
    } catch {
      void load();
    }
  };

  if (!canLoad) return null;

  return (
    <View style={[localStyles.container, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID={`${variant}-packing-list`}>
      <View style={localStyles.header}>
        <Text style={[localStyles.title, { color: theme.colors.text }]}>{title ?? 'Packing list'}</Text>
        <View style={localStyles.actions}>
          {editMode ? (
            <>
              <Pressable style={[localStyles.button, { backgroundColor: theme.colors.surfaceMuted }]} onPress={() => { if (!v2 || !isTrip) setDraftItems(items); setEditMode(false); }}>
                <Text style={[localStyles.buttonText, { color: theme.colors.text }]}>Cancel</Text>
              </Pressable>
              <Pressable style={[localStyles.button, { backgroundColor: theme.colors.cta }]} onPress={() => void save()} disabled={saving}>
                <Text style={[localStyles.buttonText, { color: '#0B1726' }]}>{saving ? 'Saving...' : 'Save'}</Text>
              </Pressable>
            </>
          ) : (
            <>
              {allowPrint && isTrip && Platform.OS === 'web' ? (
                <Pressable
                  style={[localStyles.button, { backgroundColor: theme.colors.surfaceMuted }]}
                  onPress={printList}
                  testID={`${variant}-packing-print`}
                >
                  <Text style={[localStyles.buttonText, { color: theme.colors.text }]}>Print</Text>
                </Pressable>
              ) : null}
              <Pressable style={[localStyles.button, { backgroundColor: theme.colors.surfaceMuted }]} onPress={() => { if (!v2 || !isTrip) setDraftItems(items); setEditMode(true); }}>
                <Text style={[localStyles.buttonText, { color: theme.colors.text }]}>Edit</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
      {loading ? <Text style={[localStyles.meta, { color: theme.colors.textMuted }]}>Loading...</Text> : null}
      {error ? <Text style={[localStyles.meta, { color: theme.colors.error }]}>{error}</Text> : null}
      {editMode ? (
        <Pressable
          style={[localStyles.addButton, { borderColor: theme.colors.border }]}
          onPress={addDraftItem}
          testID={`${variant}-packing-add-item`}
        >
          <Text style={[localStyles.addButtonText, { color: theme.colors.link }]}>+ Add item</Text>
        </Pressable>
      ) : null}
      {v2 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={localStyles.presetActions}>
          {presets.map((preset) => <Pressable key={preset.key} style={[localStyles.presetButton, { borderColor: theme.colors.border, backgroundColor: selectedPresetKeys.includes(preset.key) || tripPresetKeys.includes(preset.key) ? theme.colors.cta : theme.colors.surfaceMuted }]} onPress={() => void (isTrip && tripPresetKeys.includes(preset.key) ? removePreset(preset.key) : addPreset(preset.key))}><Text style={{ color: theme.colors.text }}>{isTrip ? tripPresetKeys.includes(preset.key) ? '− ' : '+ ' : selectedPresetKeys.includes(preset.key) ? '✓ ' : ''}{preset.label}</Text></Pressable>)}
        </ScrollView>
      ) : null}
      {!(!editMode && isTrip) ? <HorizontalTableScroll>
        <View>
          <View style={[localStyles.row, localStyles.headerRow, { borderColor: theme.colors.border }]}>
            <Text style={[localStyles.itemHeader, { color: theme.colors.textMuted }]}>Item</Text>
            {isTrip ? orderedTravelers.map((traveler) => (
              <Text key={traveler.id} style={[localStyles.travelerHeader, { color: theme.colors.textMuted }]} numberOfLines={1}>
                {traveler.name}
              </Text>
            )) : null}
            {editMode ? <Text style={[localStyles.editHeader, { color: theme.colors.textMuted }]}>Order</Text> : null}
          </View>
          {groupedItems.map((group) => (
            <View key={group.category}>
              <View style={[localStyles.categoryRow, { backgroundColor: theme.colors.backgroundAlt }]}>
                <Text style={[localStyles.categoryText, { color: theme.colors.text }]}>{group.category}</Text>
              </View>
              {group.items.map((item) => (
                <View key={item.id} style={[localStyles.row, { borderColor: theme.colors.border }]}>
                  <View style={localStyles.itemCell}>
                    {editMode ? (
                      <>
                        <TextInput
                          style={[localStyles.input, { borderColor: theme.colors.border, color: theme.colors.text, backgroundColor: theme.colors.surface }]}
                          value={item.category}
                          onChangeText={(category: string) => updateDraft(item.id, { category })}
                          placeholder="Category"
                          placeholderTextColor={theme.colors.textMuted}
                        />
                        <TextInput
                          style={[localStyles.input, { borderColor: theme.colors.border, color: theme.colors.text, backgroundColor: theme.colors.surface }]}
                          value={item.label}
                          onChangeText={(label: string) => updateDraft(item.id, { label })}
                          placeholder="Item"
                          placeholderTextColor={theme.colors.textMuted}
                          autoFocus={item.id === pendingFocusId}
                          onFocus={() => {
                            if (item.id === pendingFocusId) setPendingFocusId(null);
                          }}
                          testID={`${variant}-packing-item-${item.id}`}
                        />
                      </>
                    ) : (
                      <Text style={[localStyles.itemText, { color: theme.colors.text }]}>{item.label}</Text>
                    )}
                  </View>
                  {isTrip ? orderedTravelers.map((traveler) => {
                    const checked = item.packedBy?.includes(traveler.id) ?? false;
                    return (
                      <Pressable
                        key={`${item.id}-${traveler.id}`}
                        style={[localStyles.checkCell, { borderColor: theme.colors.border }]}
                        onPress={() => void togglePacked(item, traveler)}
                        disabled={editMode}
                        testID={`packing-check-${item.id}-${traveler.id}`}
                      >
                        <Text style={[localStyles.checkText, { color: checked ? theme.colors.success : theme.colors.textMuted }]}>
                          {checked ? '✓' : ''}
                        </Text>
                      </Pressable>
                    );
                  }) : null}
                  {editMode ? (
                    <View style={localStyles.editCell}>
                      <Pressable style={localStyles.orderButton} onPress={() => moveDraft(item.id, -1)}>
                        <Text style={[localStyles.orderText, { color: theme.colors.text }]}>↑</Text>
                      </Pressable>
                      <Pressable style={localStyles.orderButton} onPress={() => moveDraft(item.id, 1)}>
                        <Text style={[localStyles.orderText, { color: theme.colors.text }]}>↓</Text>
                      </Pressable>
                      <Pressable style={localStyles.orderButton} onPress={() => setDraftItems((prev) => prev.filter((entry) => entry.id !== item.id).map((entry, pos) => ({ ...entry, position: pos })))}>
                        <Text style={[localStyles.orderText, { color: theme.colors.error }]}>×</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ))}
        </View>
      </HorizontalTableScroll> : null}
      {!editMode && isTrip ? (
        <PackingListMatrix
          items={groupedItems.flatMap((group) => [{ id: `separator-${group.category}`, label: group.category, category: group.category, isCategory: true }, ...group.items])}
          travelers={orderedTravelers}
          colors={theme.colors}
          onToggle={(item, traveler) => void togglePacked(item as PackingItem, traveler)}
        />
      ) : null}
    </View>
  );
};

const localStyles = StyleSheet.create({
  container: { width: '100%', borderWidth: 1, borderRadius: 8, padding: 12, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 20, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 8 },
  button: { borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
  buttonText: { fontWeight: '700' },
  addButton: { borderWidth: 1, borderRadius: 6, padding: 10, alignSelf: 'flex-start' },
  addButtonText: { fontWeight: '700' },
  meta: { fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 44 },
  headerRow: { minHeight: 36 },
  itemHeader: { width: 240, padding: 8, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  travelerHeader: { width: 110, padding: 8, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  editHeader: { width: 116, padding: 8, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  categoryRow: { paddingHorizontal: 8, paddingVertical: 7, minHeight: 32 },
  categoryText: { fontWeight: '700' },
  itemCell: { width: 240, padding: 8, gap: 6, justifyContent: 'center' },
  itemText: { fontSize: 15 },
  checkCell: { width: 110, alignItems: 'center', justifyContent: 'center', borderLeftWidth: StyleSheet.hairlineWidth },
  checkText: { fontSize: 20, fontWeight: '700' },
  editCell: { width: 116, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  orderButton: { minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  orderText: { fontSize: 18, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, minHeight: 36 },
  presetActions: { gap: 8, paddingVertical: 2 },
  presetButton: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7 },
});

export default PackingListTable;
