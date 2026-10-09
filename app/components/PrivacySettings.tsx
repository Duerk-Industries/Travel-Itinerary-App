import React, { useState } from 'react';
import { Alert, Linking, Modal, Pressable, Share, StyleSheet, Switch, Text, View, Platform } from 'react-native';
import type { PrivacyController } from '../hooks/usePrivacyConsent';
import type { PrivacyChoice } from '../utils/privacyConsent';
import type { AppTheme } from '../theme/theme';

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 12, borderWidth: 1, gap: 10, marginVertical: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  text: { fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  rowText: { flex: 1 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { borderWidth: 1, padding: 10, borderRadius: 8, minWidth: 92, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontWeight: '600' },
  disabled: { opacity: 0.5 },
  overlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 16 },
  dialog: { borderRadius: 12, padding: 20, gap: 12, maxWidth: 520, width: '100%', alignSelf: 'center' },
});

const paletteFor = (theme: AppTheme) => ({
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
  dialog: { backgroundColor: theme.colors.surface },
  title: { color: theme.colors.text },
  label: { color: theme.colors.text },
  text: { color: theme.colors.textMuted },
  button: { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
  buttonText: { color: theme.colors.text },
  error: { color: theme.mode === 'dark' ? '#FFB4AB' : '#B42318' },
});

const ChoiceSwitch = ({ label, detail, value, disabled, onChange, theme }: {
  label: string; detail: string; value: boolean; disabled: boolean; onChange: (value: boolean) => void; theme: AppTheme;
}) => {
  const palette = paletteFor(theme);
  const offTrack = theme.mode === 'dark' ? '#60788C' : '#8999A8';
  return (
    <View style={styles.row}>
      <View style={styles.rowText}><Text style={[styles.text, palette.label]}>{label}</Text><Text style={[styles.text, palette.text]}>{detail}</Text></View>
      <Switch accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onChange}
        trackColor={{ false: offTrack, true: theme.colors.link }}
        thumbColor={theme.mode === 'dark' ? theme.colors.text : '#FFFFFF'}
        ios_backgroundColor={offTrack} />
    </View>
  );
};

/** Self-service "Delete my analytics data" (analytics Phase 4). Resolves with the erasure job. */
export const deleteAnalyticsData = async (backendUrl: string, token: string): Promise<{ id: string; status: string }> => {
  const response = await fetch(`${backendUrl}/api/account/analytics-data`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('Could not delete analytics data');
  return response.json();
};

const saveSafely = async (privacy: PrivacyController, choice: PrivacyChoice) => {
  try { await privacy.save(choice); }
  catch (error) { Alert.alert('Privacy settings', (error as Error).message); }
};

export const PrivacyChoiceDialog = ({ privacy, backendUrl, theme }: { privacy: PrivacyController; backendUrl: string; theme: AppTheme }) => {
  const [customize, setCustomize] = useState(false);
  const [product, setProduct] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);
  const status = privacy.status;
  if (!status) return null;
  const palette = paletteFor(theme);
  const productAvailable = status.productCollectionEnabled && !status.privacySignalActive;
  const diagnosticsAvailable = status.diagnosticsCollectionEnabled;
  const choice = (grant: boolean): PrivacyChoice => ({
    ...(productAvailable && !status.productConsentCurrent ? { productAnalytics: grant } : {}),
    ...(diagnosticsAvailable && !status.diagnosticsConsentCurrent ? { optionalDiagnostics: grant } : {}),
  });
  return (
    <Modal visible={privacy.showPrompt} transparent animationType="fade" onRequestClose={() => undefined}>
      <View style={styles.overlay}><View testID="privacy-choice-panel" style={[styles.dialog, palette.dialog]}>
        <Text style={[styles.title, palette.title]}>Your privacy choices</Text>
        <Text style={[styles.text, palette.text]}>You can use WanderBunnies without optional analytics or detailed diagnostics. Choose separately below, and change either choice in Account at any time.</Text>
        {status.privacySignalActive ? <Text style={[styles.text, palette.text]}>Your browser privacy signal keeps product analytics off.</Text> : null}
        {customize ? <>
          {productAvailable && !status.productConsentCurrent ? <ChoiceSwitch label="Product analytics" detail="Help us understand feature use and trip planning." value={product} disabled={privacy.saving} onChange={setProduct} theme={theme} /> : null}
          {diagnosticsAvailable && !status.diagnosticsConsentCurrent ? <ChoiceSwitch label="Detailed diagnostics" detail="Send app crash and performance details to help us fix problems." value={diagnostics} disabled={privacy.saving} onChange={setDiagnostics} theme={theme} /> : null}
        </> : null}
        <View style={styles.buttonRow}>
          <Pressable testID="privacy-choice-accept" accessibilityRole="button" disabled={privacy.saving} style={[styles.button, palette.button]} onPress={() => { void saveSafely(privacy, choice(true)); }}><Text style={[styles.buttonText, palette.buttonText]}>Accept</Text></Pressable>
          <Pressable testID="privacy-choice-reject" accessibilityRole="button" disabled={privacy.saving} style={[styles.button, palette.button]} onPress={() => { void saveSafely(privacy, choice(false)); }}><Text style={[styles.buttonText, palette.buttonText]}>Reject</Text></Pressable>
          {customize ?
            <Pressable accessibilityRole="button" disabled={privacy.saving} style={[styles.button, palette.button]} onPress={() => { void saveSafely(privacy, { ...(productAvailable && !status.productConsentCurrent ? { productAnalytics: product } : {}), ...(diagnosticsAvailable && !status.diagnosticsConsentCurrent ? { optionalDiagnostics: diagnostics } : {}) }); }}><Text style={[styles.buttonText, palette.buttonText]}>Save choices</Text></Pressable>
            : <Pressable accessibilityRole="button" style={[styles.button, palette.button]} onPress={() => setCustomize(true)}><Text style={[styles.buttonText, palette.buttonText]}>Customize</Text></Pressable>}
        </View>
        {privacy.error ? <Text style={palette.error}>{privacy.error}</Text> : null}
        <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(`${backendUrl}/privacy.html`); }}><Text style={[styles.buttonText, palette.buttonText]}>Read the privacy notice</Text></Pressable>
      </View></View>
    </Modal>
  );
};

export const AccountPrivacySettings = ({ privacy, backendUrl, token, theme }: {
  privacy: PrivacyController; backendUrl: string; token: string | null; theme: AppTheme;
}) => {
  const status = privacy.status;
  const palette = paletteFor(theme);
  const [confirmingErase, setConfirmingErase] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [eraseMessage, setEraseMessage] = useState<string | null>(null);
  const open = (path: string) => { void Linking.openURL(`${backendUrl}${path}`); };
  const eraseAnalytics = async () => {
    if (!token) return;
    setErasing(true);
    setEraseMessage(null);
    try {
      const result = await deleteAnalyticsData(backendUrl, token);
      setEraseMessage(result.status === 'completed'
        ? 'Your analytics and diagnostics data has been deleted.'
        : 'Deletion has started and will finish automatically. Check back later.');
    } catch {
      setEraseMessage('Could not delete analytics data. Try again or contact support@wander-bunnies.com.');
    } finally {
      setErasing(false);
      setConfirmingErase(false);
    }
  };
  const exportData = async () => {
    if (!token) return;
    try {
      const response = await fetch(`${backendUrl}/api/account/export`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Could not export account data');
      const content = JSON.stringify(await response.json(), null, 2);
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'wanderbunnies-account-export.json';
        link.click();
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ message: content, title: 'WanderBunnies account export' });
      }
    } catch (error) { Alert.alert('Export', (error as Error).message); }
  };
  return <View testID="privacy-settings-card" style={[styles.card, palette.card]}>
    <Text style={[styles.title, palette.title]}>Privacy</Text>
    <Text style={[styles.text, palette.text]}>Necessary account, security, quota and billing records support the service. Optional choices do not affect trip features or price.</Text>
    {privacy.loading && !status ? <Text style={[styles.text, palette.text]}>Loading privacy settings…</Text> : null}
    {privacy.error ? <Text style={palette.error}>{privacy.error}</Text> : null}
    <ChoiceSwitch label="Product analytics" detail={status?.privacySignalActive ? 'Blocked on this browser by your privacy signal.' : status?.productCollectionEnabled ? 'Feature and trip-use measurement.' : 'Collection is currently disabled.'}
      value={status?.productAnalytics === true}
      disabled={!status || privacy.saving || ((!status.productCollectionEnabled || status.privacySignalActive) && status.productAnalytics !== true)}
      onChange={(value) => { void saveSafely(privacy, { productAnalytics: value }); }} theme={theme} />
    <ChoiceSwitch label="Detailed diagnostics" detail={status?.diagnosticsCollectionEnabled ? 'App crash and performance details.' : 'Collection is currently disabled.'}
      value={status?.optionalDiagnostics === true}
      disabled={!status || privacy.saving || (!status.diagnosticsCollectionEnabled && status.optionalDiagnostics !== true)}
      onChange={(value) => { void saveSafely(privacy, { optionalDiagnostics: value }); }} theme={theme} />
    <View style={styles.buttonRow}>
      <Pressable testID="privacy-notice-button" accessibilityRole="link" style={[styles.button, palette.button]} onPress={() => open('/privacy.html')}><Text style={[styles.buttonText, palette.buttonText]}>Privacy notice</Text></Pressable>
      <Pressable accessibilityRole="link" style={[styles.button, palette.button]} onPress={() => open('/cookies.html')}><Text style={[styles.buttonText, palette.buttonText]}>Cookie notice</Text></Pressable>
      <Pressable accessibilityRole="link" style={[styles.button, palette.button]} onPress={() => open('/privacy-choices.html')}><Text style={[styles.buttonText, palette.buttonText]}>Your choices</Text></Pressable>
      <Pressable accessibilityRole="button" style={[styles.button, palette.button]} onPress={() => { void exportData(); }}><Text style={[styles.buttonText, palette.buttonText]}>Export account data</Text></Pressable>
      <Pressable accessibilityRole="button" testID="privacy-delete-analytics" disabled={!token || erasing} style={[styles.button, palette.button, (!token || erasing) && styles.disabled]} onPress={() => { setEraseMessage(null); setConfirmingErase(true); }}><Text style={[styles.buttonText, palette.buttonText]}>Delete analytics data</Text></Pressable>
      <Pressable accessibilityRole="link" style={[styles.button, palette.button]} onPress={() => open('/delete-account.html')}><Text style={[styles.buttonText, palette.buttonText]}>Delete account</Text></Pressable>
    </View>
    {confirmingErase ? <View style={[styles.card, palette.card]} testID="privacy-delete-analytics-confirm">
      <Text style={[styles.text, palette.text]}>This deletes analytics and detailed-diagnostics data linked to your account. Your trips, account and choices stay as they are. To stop future collection, turn the switches above off.</Text>
      <View style={styles.buttonRow}>
        <Pressable accessibilityRole="button" testID="privacy-delete-analytics-confirm-button" disabled={erasing} style={[styles.button, palette.button, erasing && styles.disabled]} onPress={() => { void eraseAnalytics(); }}><Text style={[styles.buttonText, palette.buttonText]}>{erasing ? 'Deleting…' : 'Delete'}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={erasing} style={[styles.button, palette.button]} onPress={() => setConfirmingErase(false)}><Text style={[styles.buttonText, palette.buttonText]}>Cancel</Text></Pressable>
      </View>
    </View> : null}
    {eraseMessage ? <Text style={[styles.text, palette.text]} testID="privacy-delete-analytics-result">{eraseMessage}</Text> : null}
  </View>;
};
