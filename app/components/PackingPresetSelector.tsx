import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

type PackingPreset = {
  key: string;
  label: string;
  description?: string;
  isActive: boolean;
};

type ThemeColors = {
  text: string;
  textMuted: string;
  border: string;
  surface: string;
  surfaceMuted?: string;
  link?: string;
};

interface PackingPresetSelectorProps {
  backendUrl: string;
  headers: Record<string, string>;
  jsonHeaders: Record<string, string>;
  theme: { colors: ThemeColors };
}

const GENERAL_KEY = 'general';

// Renders nothing when packing_lists_v2 is disabled (the presets endpoint
// 404s), so the account screen degrades cleanly on either feature-flag state
// without a separate flag lookup on the client.
const PackingPresetSelector: React.FC<PackingPresetSelectorProps> = ({ backendUrl, headers, jsonHeaders, theme }) => {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [presets, setPresets] = useState<PackingPreset[]>([]);
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const requestQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${backendUrl}/api/account/packing-list-presets`, { headers });
        if (res.status === 404) {
          if (!cancelled) setAvailable(false);
          return;
        }
        if (!res.ok) {
          if (!cancelled) setAvailable(false);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setPresets(Array.isArray(data.presets) ? data.presets : []);
        setAvailable(true);
      } catch {
        if (!cancelled) setAvailable(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [backendUrl, headers]);

  const addPreset = useCallback((key: string) => {
    if (key === GENERAL_KEY) return;
    setAddedKeys((previous) => new Set(previous).add(key));
    setError(null);
    requestQueue.current = requestQueue.current
      .catch(() => undefined)
      .then(async () => {
        const res = await fetch(`${backendUrl}/api/account/packing-list-presets/${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: jsonHeaders,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? 'Could not add that packing list.');
      })
      .catch((err: any) => {
        setAddedKeys((previous) => {
          const next = new Set(previous);
          next.delete(key);
          return next;
        });
        setError(err.message ?? 'Could not add that packing list.');
      });
  }, [backendUrl, jsonHeaders]);

  if (available === null) {
    return (
      <View style={[localStyles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]} testID="account-packing-presets-loading">
        <ActivityIndicator />
      </View>
    );
  }
  if (available === false) return null;

  const activePresets = presets.filter((preset) => preset.isActive);

  return (
    <View
      style={[localStyles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
      testID="account-packing-presets"
    >
      <Text style={[localStyles.title, { color: theme.colors.text }]}>Packing list preferences</Text>
      <Text style={[localStyles.subtitle, { color: theme.colors.textMuted }]}>
        Add a preset to your editable personal list. Those items are included in every trip you join.
      </Text>
      {error ? <Text style={localStyles.error}>{error}</Text> : null}
      <View style={[localStyles.row, { borderColor: theme.colors.border }]} testID="account-packing-preset-general">
        <View style={localStyles.rowText}>
          <Text style={[localStyles.rowLabel, { color: theme.colors.text }]}>General</Text>
          <Text style={[localStyles.rowMeta, { color: theme.colors.textMuted }]}>Always included</Text>
        </View>
        <Switch value onValueChange={() => {}} disabled testID="account-packing-preset-toggle-general" />
      </View>
      {activePresets
        .filter((preset) => preset.key !== GENERAL_KEY)
        .map((preset) => (
          <View key={preset.key} style={[localStyles.row, { borderColor: theme.colors.border }]} testID={`account-packing-preset-${preset.key}`}>
            <View style={localStyles.rowText}>
              <Text style={[localStyles.rowLabel, { color: theme.colors.text }]}>{preset.label}</Text>
              {preset.description ? <Text style={[localStyles.rowMeta, { color: theme.colors.textMuted }]}>{preset.description}</Text> : null}
            </View>
            <Pressable
              style={[localStyles.addButton, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted ?? theme.colors.surface }]}
              onPress={() => addPreset(preset.key)}
              disabled={addedKeys.has(preset.key)}
              testID={`account-packing-preset-toggle-${preset.key}`}
            >
              <Text style={{ color: theme.colors.link ?? theme.colors.text, fontWeight: '700' }}>{addedKeys.has(preset.key) ? 'Added' : 'Add'}</Text>
            </Pressable>
          </View>
        ))}
    </View>
  );
};

const localStyles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 8, padding: 14, marginVertical: 12, gap: 10 },
  title: { fontSize: 18, fontWeight: '700' },
  subtitle: { fontSize: 13 },
  error: { color: '#dc2626', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 2, paddingRight: 12 },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowMeta: { fontSize: 12 },
  addButton: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7 },
});

export default PackingPresetSelector;
