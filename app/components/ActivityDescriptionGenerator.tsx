import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { generateLocalActivityDescription, localDescriptionsAvailable, subscribeLocalDescriptions, type ActivityDescriptionInput } from '../utils/localActivityDescriptions';

export default function ActivityDescriptionGenerator({ input, onApply, styles }: {
  input: ActivityDescriptionInput; onApply: (description: string) => void; styles: Record<string, any>;
}) {
  const available = useSyncExternalStore(subscribeLocalDescriptions, localDescriptionsAvailable, () => false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(true), pending = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  if (!available && !generating && !error) return null;
  return <View style={{ gap: 8, marginVertical: 8 }}>
    {available && <TouchableOpacity style={styles.button} accessibilityRole="button" disabled={!input.name.trim() || generating}
      onPress={async () => {
        if (pending.current) return;
        pending.current = true; setGenerating(true); setError('');
        try {
          const text = (await generateLocalActivityDescription(input)).trim();
          if (!text) throw new Error('No description was generated. Please try again.');
          if (live.current) onApply(text);
        } catch (cause) { if (live.current) setError((cause as Error).message); }
        finally { pending.current = false; if (live.current) setGenerating(false); }
      }}><Text style={styles.buttonText}>Generate description</Text></TouchableOpacity>}
    {generating && <Text style={styles.helperText}>Writing description…</Text>}
    {error ? <Text accessibilityRole="alert" style={styles.helperText}>{error}</Text> : null}
  </View>;
}
