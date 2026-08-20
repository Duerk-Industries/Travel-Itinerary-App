import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';
import HorizontalTableScroll from './HorizontalTableScroll';
import PackingListMatrix from './PackingListMatrix';
import SelectField, { type SelectFieldOption } from './SelectField';
import { getAppTheme, type AppTheme } from '../theme/theme';
import { normalizePackingLabel } from '../utils/packingListNormalize';

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
  /** Reuse the app's persisted appearance choice when embedded in a screen. */
  theme?: AppTheme;
};

type PresetOption = {
  key: string;
  label: string;
  items?: PackingItem[];
};

type PackingSource = {
  key: string;
  label: string;
  kind: 'preset' | 'personal';
  active: boolean;
  ownerMemberId?: string | null;
  presetKey?: string | null;
};

const endpointFor = (variant: Props['variant'], backendUrl: string, tripId?: string | null) => {
  if (variant === 'trip') return `${backendUrl}/api/trips/${tripId}/packing-list`;
  if (variant === 'admin') return `${backendUrl}/api/admin/packing-list-defaults`;
  return `${backendUrl}/api/account/packing-list`;
};

const createDraftItem = (position: number): PackingItem => ({
  id: `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  category: 'Other',
  label: '',
  position,
  packedBy: [],
});

const isNewPackingItem = (item: PackingItem): boolean => item.id.startsWith('draft-') || item.id.startsWith('preset-');

const comparePackingItems = (a: PackingItem, b: PackingItem): number =>
  a.category.trim().localeCompare(b.category.trim(), undefined, { sensitivity: 'base' })
  || a.label.trim().localeCompare(b.label.trim(), undefined, { sensitivity: 'base' });

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

const PackingListTable: React.FC<Props> = ({ backendUrl, headers, tripId, variant, title, allowPrint = false, printTitle, theme: providedTheme }) => {
  const colorScheme = useColorScheme();
  const theme = providedTheme ?? getAppTheme('auto', colorScheme);
  const [items, setItems] = useState<PackingItem[]>([]);
  const [travelers, setTravelers] = useState<Traveler[]>([]);
  const [draftItems, setDraftItems] = useState<PackingItem[]>([]);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [v2, setV2] = useState(false);
  const [presets, setPresets] = useState<PresetOption[]>([]);
  const [selectedPresetKeys, setSelectedPresetKeys] = useState<string[]>(['general']);
  const [tripPresetKeys, setTripPresetKeys] = useState<string[]>([]);
  const [sources, setSources] = useState<PackingSource[]>([]);
  const [currentTravelerId, setCurrentTravelerId] = useState<string | null>(null);
  const userPresetRequestQueue = useRef<Promise<void>>(Promise.resolve());

  const url = endpointFor(variant, backendUrl, tripId);
  const canLoad = variant !== 'trip' || Boolean(tripId);
  const isTrip = variant === 'trip';

  const orderedTravelers = useMemo(() => {
    const list = isTrip ? [...travelers].sort((a, b) => {
      if (a.id === currentTravelerId) return -1;
      if (b.id === currentTravelerId) return 1;
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    }) : travelers;

    // Detect duplicate first names for disambiguation
    const firstNameCounts = new Map<string, number>();
    list.forEach(t => {
      const first = t.name.split(' ')[0].trim().toLowerCase();
      if (first) firstNameCounts.set(first, (firstNameCounts.get(first) || 0) + 1);
    });

    return list.map(t => {
      const parts = t.name.trim().split(/\s+/);
      const first = parts[0] || '';
      const hasMultiple = first ? (firstNameCounts.get(first.toLowerCase()) || 0) > 1 : false;

      let displayName = t.name;
      if (first && !hasMultiple) {
        displayName = first;
      } else if (!t.name.trim() && t.email) {
        displayName = t.email.split('@')[0];
      }
      // A traveler with neither a name nor an email (e.g. a guest added with
      // no contact info yet) would otherwise fall through with an empty
      // string here, rendering a blank column header — the checkbox column
      // still exists, just unlabeled. Every column needs a visible label.
      if (!displayName.trim()) {
        displayName = 'Traveler';
      }

      return { ...t, displayName };
    });
  }, [currentTravelerId, isTrip, travelers]);

  const applyResponse = (data: any) => {
    const hasGroups = Array.isArray(data.groups);
    setV2(hasGroups || data.preferences !== undefined || Array.isArray(data.tripPresetKeys));
    if (Array.isArray(data.presets)) setPresets(data.presets);
    if (data.preferences && Array.isArray(data.preferences.presetKeys)) setSelectedPresetKeys(data.preferences.presetKeys);
    if (Array.isArray(data.tripPresetKeys)) setTripPresetKeys(data.tripPresetKeys);
    if (Array.isArray(data.sources)) {
      setSources(data.sources);
    } else if (isTrip && hasGroups) {
      const fallbackPresetSources = data.groups
        .filter((group: any) => group.kind === 'preset')
        .map((group: any) => ({ key: `preset:${group.key}`, label: group.label, kind: 'preset' as const, presetKey: group.key, active: true }));
      const catalogSources = (Array.isArray(data.presets) ? data.presets : [])
        .filter((preset: PresetOption) => !fallbackPresetSources.some((source: PackingSource) => source.presetKey === preset.key))
        .map((preset: PresetOption) => ({ key: `preset:${preset.key}`, label: preset.label, kind: 'preset' as const, presetKey: preset.key, active: Array.isArray(data.tripPresetKeys) && data.tripPresetKeys.includes(preset.key) }));
      setSources([
        ...fallbackPresetSources,
        ...catalogSources,
        ...data.groups.filter((group: any) => group.kind === 'personal').map((group: any) => ({ key: group.key, label: group.label, kind: 'personal' as const, ownerMemberId: group.ownerMemberId, active: true })),
      ]);
    }
    if (typeof data.currentTravelerId === 'string') setCurrentTravelerId(data.currentTravelerId);
    const nextItems = hasGroups
      ? data.groups.flatMap((group: any) =>
          // Group headings are rendered by groupedItems below. Keeping them
          // out of the item collection prevents a heading from becoming a
          // duplicate, checkable packing item.
          (group.items ?? [])
            // Older seeded data could contain the preset title as an item
            // (for example, "General" in the General preset). It is a
            // heading artifact, not something a traveler can pack.
            .filter((item: PackingItem) => !(group.kind === 'preset' && normalizePackingLabel(item.label) === normalizePackingLabel(group.label)))
            .map((item: PackingItem) => ({ ...item, category: item.category || group.label }))
        )
      : (data.items ?? []).map((item: PackingItem, index: number) => ({ ...item, position: index }));
    setItems(nextItems);
    setDraftItems(hasGroups
      ? ((data.manualItems ?? data.groups.find((group: any) => group.kind === 'trip_manual')?.items ?? []) as PackingItem[])
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
    const source = [...(editMode ? draftItems : items)].sort(comparePackingItems);
    const groups: Array<{ category: string; items: PackingItem[] }> = [];
    const byCategory = new Map<string, { category: string; items: PackingItem[] }>();
    for (const item of source) {
      const category = item.category?.trim() || 'Other';
      const key = category.toLocaleLowerCase();
      const group = byCategory.get(key) ?? { category, items: [] };
      group.items.push({ ...item, category: group.category });
      byCategory.set(key, group);
    }
    groups.push(...byCategory.values());
    return groups;
  }, [draftItems, editMode, items]);

  const categoryOptions = useMemo<SelectFieldOption[]>(() => {
    const categories = new Map<string, string>();
    [...items, ...draftItems].forEach((item) => {
      const category = item.category.trim();
      if (category && !categories.has(category.toLocaleLowerCase())) categories.set(category.toLocaleLowerCase(), category);
    });
    if (!categories.has('other')) categories.set('other', 'Other');
    return Array.from(categories.values()).map((category) => ({ label: category, value: category }));
  }, [draftItems, items]);

  const categoryPickerStyles = {
    input: { borderWidth: 1, borderRadius: 6, minHeight: 36, backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
    dropdown: {},
    selectButton: { paddingHorizontal: 8, paddingVertical: 6, minHeight: 34 },
    selectButtonRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
    cellText: { color: theme.colors.text },
    placeholderText: { color: theme.colors.textMuted },
    selectCaret: { color: theme.colors.textMuted },
    dropdownList: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1 },
    dropdownOption: { paddingHorizontal: 8, paddingVertical: 8 },
  };

  const updateDraft = (id: string, patch: Partial<PackingItem>) => {
    setDraftItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const addDraftItem = () => {
    const item = createDraftItem(0);
    setPendingFocusId(item.id);
    setDraftItems((prev) => [item, ...prev].map((entry, pos) => ({ ...entry, position: pos })));
  };

  const persistItems = async (nextDraftItems: PackingItem[], closeEditor: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const payload = [...nextDraftItems].sort(comparePackingItems)
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
      if (closeEditor) setEditMode(false);
    } catch (err: any) {
      setError(err.message ?? 'Unable to save packing list');
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    await persistItems(draftItems, true);
  };

  const removeDraftItem = (item: PackingItem) => {
    const nextDraftItems = draftItems
      .filter((entry) => entry.id !== item.id)
      .map((entry, pos) => ({ ...entry, position: pos }));
    setDraftItems(nextDraftItems);
    if (variant !== 'user') return;
    if (item.id.startsWith('draft-') || item.id.startsWith('preset-')) {
      void persistItems(nextDraftItems, false);
      return;
    }
    setSaving(true);
    setError(null);
    void fetch(`${backendUrl}/api/account/packing-list/${encodeURIComponent(item.id)}`, { method: 'DELETE', headers })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? 'Unable to remove packing item');
        applyResponse(data);
      })
      .catch((err: any) => {
        setError(err.message ?? 'Unable to remove packing item');
        void load();
      })
      .finally(() => setSaving(false));
  };

  const enqueueUserPresetSave = (presetKey: string): void => {
    userPresetRequestQueue.current = userPresetRequestQueue.current
      .catch(() => undefined)
      .then(async () => {
        const res = await fetch(`${backendUrl}/api/account/packing-list-presets/${encodeURIComponent(presetKey)}`, {
          method: 'POST',
          headers,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? 'Unable to add preset');
        // The server assigns fresh ids to every item on every write (see
        // replaceUserPackingPreferencesV2), not just the newly-added preset's
        // items. Without applying the response here, every existing item's id
        // held in local state goes stale the moment a preset materializes in
        // the background — so a later delete-by-id call silently 404s and
        // gets "undone" by its own reload. Sync local state with what the
        // server actually stored so ids stay valid for later edits/deletes.
        applyResponse(data);
      })
      .catch((err: any) => {
        setError(err.message ?? 'Unable to add preset');
        void load();
      });
  };

  const addPreset = async (presetKey: string) => {
    if (!isTrip) {
      if (presetKey === 'general') return;
      const preset = presets.find((candidate) => candidate.key === presetKey);
      if (!preset) return;

      // Materialize the preset into the editable list before doing any I/O.
      // This keeps the button responsive even when the server is reconciling
      // several trips for the account in the background.
      const source = editMode ? draftItems : items;
      const seen = new Set(source.map((item) => normalizePackingLabel(`${item.category} ${item.label}`)));
      const additions = (preset.items ?? [])
        .filter((item) => {
          const key = normalizePackingLabel(`${item.category} ${item.label}`);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((item, index) => ({
          ...item,
          id: `preset-${presetKey}-${item.id ?? index}`,
          position: source.length + index,
        }));
      const merged = [...source, ...additions].map((item, index) => ({ ...item, position: index }));
      setItems(merged);
      setDraftItems(merged);
      setSelectedPresetKeys(['general']);
      setEditMode(true);
      enqueueUserPresetSave(presetKey);
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

  const availableTripSources = useMemo<PackingSource[]>(() => {
    if (sources.length) return sources;
    const presetSources = presets.map((preset) => ({
      key: `preset:${preset.key}`,
      label: preset.label,
      kind: 'preset' as const,
      presetKey: preset.key,
      active: tripPresetKeys.includes(preset.key),
    }));
    return presetSources;
  }, [presets, sources, tripPresetKeys]);

  const toggleTripSource = async (source: PackingSource) => {
    try {
      const res = await fetch(`${url}/sources`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: source.kind, key: source.key, enabled: !source.active }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Unable to update packing list source');
      applyResponse(data);
    } catch (err: any) {
      setError(err.message ?? 'Unable to update packing list source');
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
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator
          style={localStyles.presetScroll}
          contentContainerStyle={localStyles.presetActions}
          testID={`${variant}-packing-preset-scroll`}
        >
          {isTrip ? availableTripSources.map((source) => <Pressable key={source.key} style={[localStyles.presetButton, { borderColor: theme.colors.border, backgroundColor: source.active ? theme.colors.cta : theme.colors.surfaceMuted }]} onPress={() => void toggleTripSource(source)}><Text style={{ color: theme.colors.text }}>{source.active ? '✓ ' : '+ '}{source.label}</Text></Pressable>) : presets.map((preset) => <Pressable key={preset.key} style={[localStyles.presetButton, { borderColor: theme.colors.border, backgroundColor: selectedPresetKeys.includes(preset.key) ? theme.colors.cta : theme.colors.surfaceMuted }]} onPress={() => void addPreset(preset.key)}><Text style={{ color: theme.colors.text }}>{selectedPresetKeys.includes(preset.key) ? '✓ ' : ''}{preset.label}</Text></Pressable>)}
        </ScrollView>
      ) : null}
      {!(!editMode && isTrip) ? <HorizontalTableScroll>
        <View>
          <View style={[localStyles.row, localStyles.headerRow, { borderColor: theme.colors.border }]}>
            <Text style={[localStyles.itemHeader, { color: theme.colors.textMuted }]}>Item</Text>
            {isTrip ? orderedTravelers.map((traveler) => (
              <Text key={traveler.id} style={[localStyles.travelerHeader, { color: theme.colors.textMuted }]} numberOfLines={1}>
                {traveler.displayName}
              </Text>
            )) : null}
            {editMode ? <Text style={[localStyles.editHeader, { color: theme.colors.textMuted }]}>Actions</Text> : null}
          </View>
          {groupedItems.map((group, groupIndex) => (
            <View key={`${group.category}-${groupIndex}`}>
              <View style={[localStyles.categoryRow, { backgroundColor: theme.colors.backgroundAlt }]}>
                <Text style={[localStyles.categoryText, { color: theme.colors.text }]}>{group.category}</Text>
              </View>
              {group.items.map((item) => (
                <View key={item.id} style={[localStyles.row, { borderColor: theme.colors.border }]}>
                  <View style={localStyles.itemCell}>
                    {editMode ? (
                      <>
                        {isNewPackingItem(item) ? (
                          <SelectField
                            value={item.category}
                            options={categoryOptions}
                            onChange={(category) => updateDraft(item.id, { category })}
                            styles={categoryPickerStyles}
                            webStyle={{ ...localStyles.categorySelectWeb, color: theme.colors.text, backgroundColor: theme.colors.surface, borderColor: theme.colors.border }}
                            title="Packing category"
                            testID={`${variant}-packing-category-${item.id}`}
                          />
                        ) : null}
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
                      <Pressable
                        style={localStyles.orderButton}
                        onPress={() => removeDraftItem(item)}
                        disabled={saving}
                        accessibilityLabel={`Remove ${item.label || 'packing item'}`}
                        testID={`${variant}-packing-remove-item-${item.id}`}
                      >
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
          items={groupedItems.flatMap((group, groupIndex) => [{ id: `separator-${group.category}-${groupIndex}`, label: group.category, category: group.category, isCategory: true }, ...group.items])}
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
  row: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 44, flexShrink: 0 },
  headerRow: { minHeight: 36 },
  itemHeader: { width: 240, flexShrink: 0, padding: 8, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  travelerHeader: { width: 110, flexShrink: 0, padding: 8, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  editHeader: { width: 116, flexShrink: 0, padding: 8, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  categoryRow: { paddingHorizontal: 8, paddingVertical: 7, minHeight: 32 },
  categoryText: { fontWeight: '700' },
  itemCell: { width: 240, flexShrink: 0, padding: 8, gap: 6, justifyContent: 'center' },
  itemText: { fontSize: 15 },
  checkCell: { width: 110, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderLeftWidth: StyleSheet.hairlineWidth },
  checkText: { fontSize: 20, fontWeight: '700' },
  editCell: { width: 116, flexShrink: 0, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  orderButton: { minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  orderText: { fontSize: 18, fontWeight: '700' },
  categorySelectWeb: { width: '100%', minHeight: 36, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, fontSize: 14 },
  input: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, minHeight: 36 },
  // Constrain the horizontal viewport. Without an explicit width/flex
  // constraint React Native Web can size this ScrollView to its children,
  // leaving no overflow area to scroll.
  presetScroll: { width: '100%', maxWidth: '100%', minWidth: 0, flexGrow: 0, flexShrink: 1, alignSelf: 'stretch' },
  presetActions: { gap: 8, paddingVertical: 2, flexGrow: 0, flexShrink: 0, alignItems: 'center' },
  presetButton: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7 },
});

export default PackingListTable;
