import React, { useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function AirportInput({ backendUrl, headers, value, onChange, styles, testID }: {
  backendUrl: string;
  headers?: Record<string, string>;
  value: string;
  onChange: (location: string, code: string) => void;
  styles: Record<string, any>;
  testID: string;
}) {
  const [focused, setFocused] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    setOptions([]);
    if (!focused || !value.trim()) return;
    const timer = setTimeout(() => {
      void fetch(`${backendUrl}/api/transfers/locations?q=${encodeURIComponent(value.trim())}`, { headers })
        .then(async response => response.ok ? response.json() : [])
        .then((labels: unknown) => {
          if (active && Array.isArray(labels)) setOptions(labels.filter((label): label is string =>
            typeof label === 'string' && /\([A-Za-z0-9]{3,4}\)/.test(label)));
        }).catch(() => { if (active) setOptions([]); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [backendUrl, headers, value, focused]);
  return <View>
    <TextInput testID={testID} style={styles.input} value={value} placeholder="Search airports or cities"
      onFocus={() => setFocused(true)}
      onChangeText={text => { setFocused(true); onChange(text, ''); }} />
    {focused && options.map(label => <TouchableOpacity key={label} accessibilityRole="button"
      testID={`${testID}-option-${label.match(/\(([A-Za-z0-9]{3,4})\)/)?.[1]}`}
      style={styles.dropdownOption} onPress={() => {
        const code = label.match(/\(([A-Za-z0-9]{3,4})\)/)?.[1].toUpperCase() || '';
        onChange(label, code);
        setFocused(false);
        setOptions([]);
      }}><Text style={styles.cellText}>{label}</Text></TouchableOpacity>)}
  </View>;
}
