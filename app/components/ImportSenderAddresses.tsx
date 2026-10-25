import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

type Address = { id: string; email: string; status: 'PENDING' | 'VERIFIED'; verifiedAt: number | null };

/** Lets someone confirm other email addresses they forward from. A code is emailed to the address;
 * entering it proves they can read that mailbox. For now this does not change how forwarded
 * bookings are handled, and the copy says so. */
export default function ImportSenderAddresses({ backendUrl, headers, styles }: { backendUrl: string; headers: Record<string, string>; styles: Record<string, any> }) {
  const _styleTheme = useStyleTheme();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [awaiting, setAwaiting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false);
  const base = `${backendUrl}/api/ingestion/forwarding/addresses`;
  const json = { ...headers, 'Content-Type': 'application/json' };

  const refresh = async () => {
    try {
      const response = await fetch(base, { headers });
      if (response.ok) setAddresses((await response.json()).addresses ?? []);
    } catch { /* the list is optional; adding still works */ }
  };
  // Loaded when opened, so Imports makes no extra request for people who never use this.
  useEffect(() => { if (open) void refresh(); }, [open, backendUrl]);

  const call = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await work(); } catch (error) { setNotice((error as Error).message || 'Something went wrong. Please try again.'); }
    finally { setBusy(false); }
  };
  const readError = async (response: Response, fallback: string): Promise<never> => {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || fallback);
  };

  const sendCode = () => call(async () => {
    const response = await fetch(base, { method: 'POST', headers: json, body: JSON.stringify({ email }) });
    if (!response.ok) return readError(response, 'We could not send a code. Check the address and try again.');
    const result = await response.json();
    if (result.status === 'VERIFIED') { setNotice('That address is already confirmed.'); setAwaiting(null); setEmail(''); }
    else { setAwaiting(email.trim()); setCode(''); setNotice(`We sent a code to ${email.trim()}. It expires in 30 minutes.`); }
    await refresh();
  });
  const confirm = () => call(async () => {
    const response = await fetch(`${base}/confirm`, { method: 'POST', headers: json, body: JSON.stringify({ email: awaiting, code }) });
    if (!response.ok) return readError(response, 'That code is not valid. Request a new one.');
    setNotice(`${awaiting} is confirmed.`); setAwaiting(null); setEmail(''); setCode('');
    await refresh();
  });
  const remove = (address: Address) => call(async () => {
    const response = await fetch(`${base}/${address.id}`, { method: 'DELETE', headers });
    if (!response.ok && response.status !== 404) return readError(response, 'That address could not be removed. Try again.');
    setNotice(`${address.email} was removed.`);
    await refresh();
  });

  const confirmed = addresses.filter(a => a.status === 'VERIFIED');
  const input = themeStyle('components_ImportSenderAddresses_1', {  }, _styleTheme);
  const button = (label: string, action: () => void, testID: string, disabled = false) => (
    <TouchableOpacity testID={testID} style={[styles.button, themeStyle('components_ImportSenderAddresses_2', { disabled: disabled, busy: busy }, _styleTheme)]} accessibilityRole="button" accessibilityState={{ disabled: disabled || busy }} disabled={disabled || busy} onPress={action}>
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
  return <View testID="import-sender-addresses" style={themeStyle('components_ImportSenderAddresses_3', {  }, _styleTheme)}>
    <Text style={styles.sectionTitle}>Other email addresses you forward from</Text>
    <TouchableOpacity testID="import-sender-toggle" accessibilityRole="button" accessibilityState={{ expanded: open }} style={[styles.button, themeStyle('components_ImportSenderAddresses_4', {  }, _styleTheme)]} onPress={() => setOpen(value => !value)}>
      <Text style={styles.buttonText}>{open ? 'Hide' : 'Add or manage addresses'}</Text>
    </TouchableOpacity>
    {open ? <>
    <Text style={styles.helperText}>Confirm an address by entering a code we email to it. For now this only records which addresses are yours; it does not change how forwarded bookings are handled, and every booking still needs your review.</Text>
    {confirmed.map(address => (
      <View key={address.id} style={styles.row}>
        <Text style={styles.helperText}>{address.email} · Confirmed</Text>
        {button('Remove', () => void remove(address), `import-sender-remove-${address.id}`)}
      </View>
    ))}
    <TextInput testID="import-sender-email" value={email} onChangeText={setEmail} placeholder="name@example.com" accessibilityLabel="Email address to confirm" autoCapitalize="none" keyboardType="email-address" autoCorrect={false} style={input} />
    {button(awaiting ? 'Send a new code' : 'Send a code', () => void sendCode(), 'import-sender-send', !email.trim())}
    {awaiting ? <>
      <TextInput testID="import-sender-code" value={code} onChangeText={setCode} placeholder="8-character code" accessibilityLabel={`Code sent to ${awaiting}`} autoCapitalize="none" autoCorrect={false} maxLength={8} style={input} />
      {button('Confirm address', () => void confirm(), 'import-sender-confirm', code.trim().length !== 8)}
    </> : null}
    </> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.helperText}>{notice}</Text> : null}
  </View>;
}
