import { resolveComponentTheme as resolveStyleTheme, themeStyle } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
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
const PackingPresetSelector: React.FC<PackingPresetSelectorProps> = ({ backendUrl, headers, jsonHeaders, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
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
      <View style={[localStyles(_styleTheme).card, themeStyle('components_PackingPresetSelector_1', { theme: theme }, _styleTheme)]} testID="account-packing-presets-loading">
        <ActivityIndicator />
      </View>
    );
  }
  if (available === false) return null;

  const activePresets = presets.filter((preset) => preset.isActive);

  return (
    <View
      style={[localStyles(_styleTheme).card, themeStyle('components_PackingPresetSelector_2', { theme: theme }, _styleTheme)]}
      testID="account-packing-presets"
    >
      <Text style={[localStyles(_styleTheme).title, themeStyle('components_PackingPresetSelector_3', { theme: theme }, _styleTheme)]}>Packing list preferences</Text>
      <Text style={[localStyles(_styleTheme).subtitle, themeStyle('components_PackingPresetSelector_4', { theme: theme }, _styleTheme)]}>
        Add a preset to your editable personal list. Those items are included in every trip you join.
      </Text>
      {error ? <Text style={localStyles(_styleTheme).error}>{error}</Text> : null}
      <View style={[localStyles(_styleTheme).row, themeStyle('components_PackingPresetSelector_5', { theme: theme }, _styleTheme)]} testID="account-packing-preset-general">
        <View style={localStyles(_styleTheme).rowText}>
          <Text style={[localStyles(_styleTheme).rowLabel, themeStyle('components_PackingPresetSelector_6', { theme: theme }, _styleTheme)]}>General</Text>
          <Text style={[localStyles(_styleTheme).rowMeta, themeStyle('components_PackingPresetSelector_7', { theme: theme }, _styleTheme)]}>Always included</Text>
        </View>
        <Switch value onValueChange={() => {}} disabled testID="account-packing-preset-toggle-general" />
      </View>
      {activePresets
        .filter((preset) => preset.key !== GENERAL_KEY)
        .map((preset) => (
          <View key={preset.key} style={[localStyles(_styleTheme).row, themeStyle('components_PackingPresetSelector_8', { theme: theme }, _styleTheme)]} testID={`account-packing-preset-${preset.key}`}>
            <View style={localStyles(_styleTheme).rowText}>
              <Text style={[localStyles(_styleTheme).rowLabel, themeStyle('components_PackingPresetSelector_9', { theme: theme }, _styleTheme)]}>{preset.label}</Text>
              {preset.description ? <Text style={[localStyles(_styleTheme).rowMeta, themeStyle('components_PackingPresetSelector_10', { theme: theme }, _styleTheme)]}>{preset.description}</Text> : null}
            </View>
            <Pressable
              style={[localStyles(_styleTheme).addButton, themeStyle('components_PackingPresetSelector_11', { theme: theme }, _styleTheme)]}
              onPress={() => addPreset(preset.key)}
              disabled={addedKeys.has(preset.key)}
              testID={`account-packing-preset-toggle-${preset.key}`}
            >
              <Text style={themeStyle('components_PackingPresetSelector_12', { theme: theme }, _styleTheme)}>{addedKeys.has(preset.key) ? 'Added' : 'Add'}</Text>
            </Pressable>
          </View>
        ))}
    </View>
  );
};

const localStyles = (_theme: import('../theme/theme').AppTheme) => themeStyle('components_PackingPresetSelector_13', { StyleSheet: StyleSheet }, _theme);

export default PackingPresetSelector;
