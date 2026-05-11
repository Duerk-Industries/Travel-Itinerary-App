import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';
import { getAppTheme } from '../theme/theme';

export type PackingItem = {
  id: string;
  category: string;
  label: string;
  position: number;
  packedBy?: string[];
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
};

const endpointFor = (variant: Props['variant'], backendUrl: string, tripId?: string | null) => {
  if (variant === 'trip') return `${backendUrl}/api/trips/${tripId}/packing-list`;
  if (variant === 'admin') return `${backendUrl}/api/admin/packing-list-defaults`;
  return `${backendUrl}/api/account/packing-list`;
};

const createDraftItem = (position: number): PackingItem => ({
  id: `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  category: 'Miscellaneous',
  label: '',
  position,
  packedBy: [],
});

const PackingListTable: React.FC<Props> = ({ backendUrl, headers, tripId, variant, title }) => {
  const colorScheme = useColorScheme();
  const theme = getAppTheme('auto', colorScheme);
  const [items, setItems] = useState<PackingItem[]>([]);
  const [travelers, setTravelers] = useState<Traveler[]>([]);
  const [draftItems, setDraftItems] = useState<PackingItem[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = endpointFor(variant, backendUrl, tripId);
  const canLoad = variant !== 'trip' || Boolean(tripId);
  const isTrip = variant === 'trip';

  const load = useCallback(async () => {
    if (!canLoad) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Unable to load packing list');
      const nextItems = (data.items ?? []).map((item: PackingItem, index: number) => ({ ...item, position: index }));
      setItems(nextItems);
      setDraftItems(nextItems);
      setTravelers(data.travelers ?? []);
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
        body: JSON.stringify({ items: payload, reason: 'Updated packing list defaults' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Unable to save packing list');
      const nextItems = (data.items ?? []).map((item: PackingItem, index: number) => ({ ...item, position: index }));
      setItems(nextItems);
      setDraftItems(nextItems);
      setEditMode(false);
    } catch (err: any) {
      setError(err.message ?? 'Unable to save packing list');
    } finally {
      setSaving(false);
    }
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
              <Pressable style={[localStyles.button, { backgroundColor: theme.colors.surfaceMuted }]} onPress={() => { setDraftItems(items); setEditMode(false); }}>
                <Text style={[localStyles.buttonText, { color: theme.colors.text }]}>Cancel</Text>
              </Pressable>
              <Pressable style={[localStyles.button, { backgroundColor: theme.colors.cta }]} onPress={() => void save()} disabled={saving}>
                <Text style={[localStyles.buttonText, { color: '#0B1726' }]}>{saving ? 'Saving...' : 'Save'}</Text>
              </Pressable>
            </>
          ) : (
            <Pressable style={[localStyles.button, { backgroundColor: theme.colors.surfaceMuted }]} onPress={() => { setDraftItems(items); setEditMode(true); }}>
              <Text style={[localStyles.buttonText, { color: theme.colors.text }]}>Edit</Text>
            </Pressable>
          )}
        </View>
      </View>
      {loading ? <Text style={[localStyles.meta, { color: theme.colors.textMuted }]}>Loading...</Text> : null}
      {error ? <Text style={[localStyles.meta, { color: theme.colors.error }]}>{error}</Text> : null}
      {editMode ? (
        <Pressable
          style={[localStyles.addButton, { borderColor: theme.colors.border }]}
          onPress={() => setDraftItems((prev) => [...prev, createDraftItem(prev.length)])}
          testID={`${variant}-packing-add-item`}
        >
          <Text style={[localStyles.addButtonText, { color: theme.colors.link }]}>+ Add item</Text>
        </Pressable>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <View style={[localStyles.row, localStyles.headerRow, { borderColor: theme.colors.border }]}>
            <Text style={[localStyles.itemHeader, { color: theme.colors.textMuted }]}>Item</Text>
            {isTrip ? travelers.map((traveler) => (
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
                          testID={`${variant}-packing-item-${item.id}`}
                        />
                      </>
                    ) : (
                      <Text style={[localStyles.itemText, { color: theme.colors.text }]}>{item.label}</Text>
                    )}
                  </View>
                  {isTrip ? travelers.map((traveler) => {
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
      </ScrollView>
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
});

export default PackingListTable;
