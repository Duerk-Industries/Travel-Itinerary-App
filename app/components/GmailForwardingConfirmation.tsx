import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useEffect, useState } from 'react';
import { AppState, TouchableOpacity, View } from 'react-native';
import { ThemedText as Text } from './ThemedText';
import { copyToClipboard } from '../utils/clipboard';
import type { GmailForwardingConfirmation as ConfirmationData } from '../../server/src/types';
type Confirmation = ConfirmationData & { id: string };
export default function GmailForwardingConfirmation({ address, backendUrl, headers }: { address: string; backendUrl: string; headers: Record<string, string> }) {
  const _styleTheme = useStyleTheme();
  const scope = JSON.stringify([address, backendUrl, headers]);
  const [result, setResult] = useState<{ scope: string; confirmations: Confirmation[] } | null>(null);
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let cancelled = false; let controller: AbortController | undefined;
    const refresh = async () => {
      controller?.abort(); controller = new AbortController();
      const request = controller;
      const timer = setTimeout(() => request.abort(), 5_000);
      try {
        const response = await fetch(`${backendUrl}/api/ingestion/forwarding/confirmations`, { headers, cache: 'no-store', signal: request.signal });
        if (!response.ok) throw new Error('Unavailable');
        const data = await response.json();
        if (!cancelled && controller === request) setResult({ scope, confirmations: (Array.isArray(data.confirmations) ? data.confirmations as Confirmation[] : []).filter(c => /^[0-9]{9}$/.test(c.code) && c.expiresAt > Date.now()).slice(0, 5) });
      } catch { if (!cancelled && controller === request) { setResult({ scope, confirmations: [] }); setNotice('No verified code available yet. Finish adding your address in Gmail, then check again.'); } }
      finally { clearTimeout(timer); }
    };
    void refresh();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, 15_000);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => { cancelled = true; controller?.abort(); clearInterval(timer); listener.remove(); };
  }, [scope, tick]);
  const confirmations = result?.scope === scope ? result.confirmations.filter(c => c.expiresAt > Date.now()) : [];
  return <View testID="gmail-forwarding-confirmation" style={themeStyle('components_GmailForwardingConfirmation_1', {  }, _styleTheme)}>
    <Text>Gmail confirmation</Text>
    <Text>After adding your private address in Gmail, a verified confirmation code will appear here. Enter it in Gmail yourself. WanderBunnies does not approve links or create mail rules.</Text>
    {confirmations.map(confirmation => <View key={confirmation.id}>
      <Text>Requested by {confirmation.requestedBy}</Text>
      <Text selectable accessibilityLabel="Gmail confirmation code">{confirmation.code}</Text>
      <TouchableOpacity accessibilityRole="button" onPress={() => { void copyToClipboard(confirmation.code).then(result => setNotice(result === 'copied' ? 'Code copied. Return to Gmail to finish confirmation.' : 'Select the code above and copy it.')); }} style={themeStyle('components_GmailForwardingConfirmation_2', {  }, _styleTheme)}><Text>Copy Gmail code</Text></TouchableOpacity>
    </View>)}
    {!confirmations.length && <Text>No verified Gmail confirmation received yet.</Text>}
    <TouchableOpacity accessibilityRole="button" onPress={() => { setNotice(''); setTick(n => n + 1); }} style={themeStyle('components_GmailForwardingConfirmation_3', {  }, _styleTheme)}><Text>Check for Gmail code</Text></TouchableOpacity>
    {notice ? <Text accessibilityLiveRegion="polite">{notice}</Text> : null}
  </View>;
}
