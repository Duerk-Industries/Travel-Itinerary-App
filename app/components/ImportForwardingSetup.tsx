import React, { useEffect, useState } from 'react';
import { Alert, Image, Platform, Share, Text, TouchableOpacity, View } from 'react-native';
import { copyToClipboard } from '../utils/clipboard';
import ImportSenderAddresses from './ImportSenderAddresses';

export default function ImportForwardingSetup({ address, backendUrl, headers, onRotated, styles }: {
  address: string; backendUrl: string; headers: Record<string, string>; onRotated: (address: string) => void; styles: Record<string, any>;
}) {
  const [qr, setQr] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [rotate, setRotate] = useState(false);
  const [provider, setProvider] = useState('');
  useEffect(() => {
    let cancelled = false;
    void import('qrcode-generator').then(({ default: qrcode }) => {
      const code = qrcode(0, 'M'); code.addData(`mailto:${address}`); code.make();
      if (!cancelled) setQr(code.createDataURL(4, 8));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [address]);
  const request = async (action: 'test' | 'rotate') => {
    if (busy) return; setBusy(true);
    try {
      const response = await fetch(`${backendUrl}/api/ingestion/forwarding/${action}`, { method: 'POST', headers });
      if (!response.ok) throw new Error(action === 'test' ? 'Test unavailable. You can still copy your address or upload a confirmation.' : 'Your address could not be changed. Try again.');
      const result = await response.json();
      if (action === 'rotate') { onRotated(result.currentAddress); setRotate(false); setNotice('Address changed. Update your forwarding rules and saved contact.'); }
      else setNotice('Test received. Your import inbox is ready. To check your email provider’s rule, forward a confirmation and review it here. This test creates no booking and uses no import allowance.');
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  };
  const contact = async () => {
    const vcard = `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:WanderBunnies Imports\r\nEMAIL:${address}\r\nEND:VCARD\r\n`;
    try {
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([vcard], { type: 'text/vcard' }));
        const link = document.createElement('a'); link.href = url; link.download = 'WanderBunnies-Imports.vcf'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const { File, Paths } = await import('expo-file-system');
        const file = new File(Paths.cache, 'WanderBunnies-Imports.vcf'); file.write(vcard);
        const sharing = await import('expo-sharing');
        if (await sharing.isAvailableAsync()) await sharing.shareAsync(file.uri, { mimeType: 'text/vcard', UTI: 'public.vcard' });
        else await Share.share({ message: address });
      }
    } catch { setNotice('Contact could not be saved. Copy the address instead.'); }
  };
  const button = (label: string, action: () => void) => <TouchableOpacity key={label} style={[styles.button, { minHeight: 44 }]} accessibilityRole="button" disabled={busy} onPress={action}><Text style={styles.buttonText}>{label}</Text></TouchableOpacity>;
  return <View style={styles.section}>
    <Text style={styles.sectionTitle}>Forward by Email</Text>
    <Text selectable style={styles.flightTitle}>{address}</Text>
    <Text style={styles.helperText}>Keep this address private. Every tripmate has their own address. Check each booking before adding it to a trip.</Text>
    <View style={styles.row}>
      {button('Copy my forwarding address', () => { void copyToClipboard(address).then(result => setNotice(result === 'copied' ? 'Address copied.' : 'Select the address above and copy it.')); })}
      {button('Add to contacts', () => void contact())}
      {button('Send a test', () => void request('test'))}
      {button('Rotate address', () => setRotate(true))}
    </View>
    {qr ? <Image source={{ uri: qr }} style={{ width: 180, height: 180 }} accessibilityLabel="QR code for your private forwarding address" /> : null}
    {rotate && <View><Text>Changing your address stops mail to the old address immediately. Update any forwarding rules afterward.</Text><View style={styles.row}>{button('Change my address', () => void request('rotate'))}{button('Keep current address', () => setRotate(false))}</View></View>}
    <Text style={styles.helperText}>Set up automatic forwarding (optional)</Text>
    <View style={styles.row}>{['Gmail', 'Outlook', 'Apple Mail'].map(name => button(name, () => setProvider(name)))}</View>
    {provider && <Text style={styles.helperText}>{provider === 'Gmail'
      ? 'In Gmail on a computer: Settings → See all settings → Forwarding and POP/IMAP → Add a forwarding address. Paste your address. Complete Gmail’s confirmation, then create a filter for travel confirmations and choose Forward it. Forward a booking to check the rule. Forwarding confirmation recognition becomes available only after the receiver’s verification checks have been validated.'
      : provider === 'Outlook' ? 'In Outlook: Settings → Mail → Rules → Add new rule. Choose the travel senders or subjects you want, then Forward to your private address. Save and forward a booking to check it.'
      : 'In Mail on your Mac: Mail → Settings → Rules → Add Rule. Match travel senders or subjects and choose Forward Message to your private address. Your Mac must be running Mail for the rule to run.'}</Text>}
    <Text style={styles.helperText}>You can do this later and upload a confirmation instead. These steps open in your email provider; WanderBunnies does not create mail rules for you.</Text>
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.helperText}>{notice}</Text> : null}
    <ImportSenderAddresses backendUrl={backendUrl} headers={headers} styles={styles} />
  </View>;
}
