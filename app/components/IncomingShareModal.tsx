// @ts-nocheck
import IconText from './IconText';
import { resolveComponentTheme as resolveStyleTheme, themeStyle } from '../theme/theme';


import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
// @ts-nocheck
// Mounted once near the top of app/App.tsx (see useShareIntent's own requirement to run before
// other providers). Surfaces whenever the OS reports a pending "send to WanderBunnies" share —
// lets the traveler confirm which trip/day it belongs to, preview what was shared, add an
// optional message, then uploads via the same app/utils/blogUpload.ts plumbing the in-tab
// "+ Photo/Video" button uses.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DialogShell from './DialogShell';
import DateField from './DateField';
import { useShareIntent, planShareUpload, normalizeShareIntentFiles } from '../utils/incomingShare';
import { uploadOneBlogFile, uploadBlogFiles, createDayTextItem, isVideoMimeType } from '../utils/blogUpload';

const todayDate = () => new Date().toISOString().slice(0, 10);
const isValidDayDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);

// Clamp a default day into the trip's known range when one is available, rather than defaulting
// to "today" for a trip that isn't happening today (e.g. sharing photos from a past or future
// trip's planning). Falls back to today when the trip has no known dates.
const defaultDayDateFor = (trip) => {
  const today = todayDate();
  if (!trip?.startDate || !trip?.endDate) return today;
  if (today < trip.startDate) return trip.startDate;
  if (today > trip.endDate) return trip.endDate;
  return today;
};

type IncomingShareModalProps = {
  backendUrl: string;
  headers: Record<string, string>;
  trips?: Array<{ id: string; name: string; startDate?: string | null; endDate?: string | null }>;
  activeTripId?: string | null;
  styles?: any;
  theme?: any;
  onImported?: () => void;
};

const IncomingShareModal = ({ backendUrl, headers, trips = [], activeTripId, styles, theme: _providedTheme, onImported }: IncomingShareModalProps) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const [selectedTripId, setSelectedTripId] = useState(activeTripId ?? null);
  const [dayDate, setDayDate] = useState(todayDate());
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const textColor = theme?.colors?.text ?? themeStyle('components_IncomingShareModal_22', {  }, (theme ?? _styleTheme));
  const mutedColor = theme?.colors?.textMuted ?? themeStyle('components_IncomingShareModal_23', {  }, (theme ?? _styleTheme));
  const borderColor = theme?.colors?.border ?? themeStyle('components_IncomingShareModal_24', {  }, (theme ?? _styleTheme));
  const surfaceColor = theme?.colors?.surface ?? themeStyle('components_IncomingShareModal_25', {  }, (theme ?? _styleTheme));
  const dateFieldStyles = {
    ...(styles ?? {}),
    cellText: themeStyle('components_IncomingShareModal_1', { styles: styles, textColor: textColor }, (theme ?? _styleTheme)),
  };
  const dateFieldStyle = themeStyle('components_IncomingShareModal_2', { borderColor: borderColor, textColor: textColor }, (theme ?? _styleTheme));

  useEffect(() => {
    if (!hasShareIntent) return;
    const fallbackTripId = activeTripId ?? trips[0]?.id ?? null;
    setSelectedTripId(fallbackTripId);
    const trip = trips.find((candidate) => candidate.id === fallbackTripId);
    setDayDate(defaultDayDateFor(trip));
    setMessage(shareIntent?.text ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShareIntent]);

  if (!hasShareIntent) return null;

  const files = shareIntent?.files ?? [];
  const selectedTrip = trips.find((candidate) => candidate.id === selectedTripId) ?? null;

  const close = () => {
    resetShareIntent();
    setMessage('');
  };

  const importFiles = async () => {
    if (submitting) return;
    const supported = files.filter(file => /^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.mimeType || ''));
    if (!supported.length || supported.length !== files.length || supported.length > 10) {
      Alert.alert('Import confirmation', 'Share up to 10 PDF, PNG, JPEG, or WebP confirmations.'); return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      supported.forEach(file => form.append('files', { uri: file.path, name: file.fileName || 'confirmation', type: file.mimeType } as any));
      const response = await fetch(`${backendUrl}/api/ingestion/upload`, { method: 'POST', headers: { Authorization: headers.Authorization }, body: form });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Import unavailable. Try the Imports screen.');
      Alert.alert('Confirmation received', 'Your files will be scanned before parsing. Review the booking and choose its trip in Imports.');
      close(); onImported?.();
    } catch (error) { Alert.alert('Import confirmation', error?.message || 'Upload failed. Your shared files have not been added.'); }
    finally { setSubmitting(false); }
  };

  const submit = async () => {
    if (!selectedTripId || !isValidDayDate(dayDate) || submitting) return;
    setSubmitting(true);
    try {
      const context = { backendUrl, headers, tripId: selectedTripId };
      const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : '';
      const handoff = await fetch(`${backendUrl}/api/trips/${selectedTripId}/blog/share-intent`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      });
      if (!handoff.ok) throw new Error((await handoff.json().catch(() => ({}))).error || 'Quick capture is not available');
      const normalized = await normalizeShareIntentFiles(files);
      if (!normalized.length) {
        Alert.alert('Send to WanderBunnies', 'Unable to read the shared photo or video. Please try sharing again.');
        return;
      }
      const plan = planShareUpload(normalized.length, message);
      let succeeded = 0;
      let failed = 0;
      let entitlementSkipped = 0;
      let quotaBlocked = false;

      if (normalized.length === 1) {
        const result = await uploadOneBlogFile(context, dayDate, normalized[0], plan.captionForSingleItem);
        if (result.outcome === 'ok') succeeded = 1;
        else if (result.outcome === 'quota_exceeded') quotaBlocked = true;
        else if (result.outcome === 'entitlement_required') entitlementSkipped = 1;
        else failed = 1;
      } else {
        const batch = await uploadBlogFiles(context, dayDate, normalized);
        succeeded = batch.succeeded;
        failed = batch.failed;
        entitlementSkipped = batch.entitlementSkipped;
        quotaBlocked = batch.quotaBlocked;
        if (plan.dayMessage && succeeded > 0) {
          try { await createDayTextItem(context, dayDate, plan.dayMessage); } catch { /* the photos/videos still uploaded; the message is best-effort */ }
        }
      }

      const parts = [];
      if (succeeded > 0) parts.push(`${succeeded} added to ${selectedTrip?.name ?? 'the trip'}'s blog`);
      if (failed > 0) parts.push(`${failed} failed`);
      if (entitlementSkipped > 0) parts.push(`${entitlementSkipped} skipped (video requires Premium)`);
      if (quotaBlocked) parts.push('remaining items skipped (storage full — manage storage in the trip blog)');
      Alert.alert('Send to WanderBunnies', parts.join(', ') || 'Nothing was uploaded.');
      close();
    } catch (error) {
      Alert.alert('Send to WanderBunnies', error?.message || 'Unable to upload the shared item(s).');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogShell scrollable={false} visible title="Send to WanderBunnies" styles={styles} onClose={close} useNativeModal cardStyle={themeStyle('components_IncomingShareModal_3', {  }, (theme ?? _styleTheme))}>
      <ScrollView style={themeStyle('components_IncomingShareModal_4', {  }, (theme ?? _styleTheme))}>
        <Text style={themeStyle('components_IncomingShareModal_5', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>
          {files.length} {files.length === 1 ? 'item' : 'items'} shared from your device.
        </Text>

        <View style={themeStyle('components_IncomingShareModal_6', {  }, (theme ?? _styleTheme))}>
          {files.map((file, index) => (
            <View key={file.path ?? index} style={themeStyle('components_IncomingShareModal_7', { borderColor: borderColor, surfaceColor: surfaceColor }, (theme ?? _styleTheme))}>
              {isVideoMimeType(file.mimeType) ? (
                <IconText style={themeStyle('components_IncomingShareModal_8', {  }, (theme ?? _styleTheme))}>🎬</IconText>
              ) : (
                <Image source={{ uri: file.path }} style={themeStyle('components_IncomingShareModal_9', {  }, (theme ?? _styleTheme))} resizeMode="cover" />
              )}
            </View>
          ))}
        </View>

        {trips.length > 1 ? (
          <>
            <Text style={themeStyle('components_IncomingShareModal_10', { textColor: textColor }, (theme ?? _styleTheme))}>Trip</Text>
            <View style={themeStyle('components_IncomingShareModal_11', {  }, (theme ?? _styleTheme))}>
              {trips.map((trip) => (
                <TouchableOpacity
                  key={trip.id}
                  testID={`share-trip-${trip.id}`}
                  accessibilityRole="button"
                  onPress={() => { setSelectedTripId(trip.id); setDayDate(defaultDayDateFor(trip)); }}
                  style={[styles?.button, themeStyle('components_IncomingShareModal_12', { trip: trip, selectedTripId: selectedTripId, theme: theme }, (theme ?? _styleTheme))]}
                >
                  <Text style={trip.id === selectedTripId ? styles?.buttonText : themeStyle('components_IncomingShareModal_13', { textColor: textColor }, (theme ?? _styleTheme))}>{trip.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}

        <Text style={themeStyle('components_IncomingShareModal_14', { textColor: textColor }, (theme ?? _styleTheme))}>Day (YYYY-MM-DD)</Text>
        <DateField
          testID="share-day-input"
          value={dayDate}
          onChange={setDayDate}
          minDate={selectedTrip?.startDate ?? undefined}
          maxDate={selectedTrip?.endDate ?? undefined}
          placeholder="Select day"
          styles={dateFieldStyles}
          theme={theme}
          style={dateFieldStyle}
          accessibilityLabel="Trip day"
        />

        <Text style={themeStyle('components_IncomingShareModal_15', { textColor: textColor }, (theme ?? _styleTheme))}>Message (optional)</Text>
        <TextInput
          testID="share-message-input"
          multiline
          value={message}
          onChangeText={setMessage}
          placeholder={files.length > 1 ? 'A note about today…' : 'Add a caption…'}
          placeholderTextColor={mutedColor}
          style={themeStyle('components_IncomingShareModal_16', { borderColor: borderColor, textColor: textColor }, (theme ?? _styleTheme))}
        />
        <Text style={themeStyle('components_IncomingShareModal_17', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>
          {files.length > 1 ? 'With multiple items, this becomes a general message for the day.' : 'With a single item, this becomes its caption.'}
        </Text>
      </ScrollView>

      <View style={themeStyle('components_IncomingShareModal_18', {  }, (theme ?? _styleTheme))}>
        <TouchableOpacity accessibilityRole="button" disabled={submitting} onPress={importFiles} style={[styles?.button, themeStyle('components_IncomingShareModal_19', {  }, (theme ?? _styleTheme))]}><Text style={styles?.buttonText}>Import to WanderBunnies</Text></TouchableOpacity>
        <TouchableOpacity
          testID="share-submit"
          accessibilityRole="button"
          disabled={submitting || !selectedTripId || !isValidDayDate(dayDate) || files.some(file => file.mimeType === 'application/pdf')}
          onPress={submit}
          style={styles?.button}
        >
          {submitting ? <ActivityIndicator /> : <Text style={styles?.buttonText}>Add to trip blog</Text>}
        </TouchableOpacity>
        <TouchableOpacity testID="share-cancel" accessibilityRole="button" disabled={submitting} onPress={close} style={[styles?.button, themeStyle('components_IncomingShareModal_20', { theme: theme }, (theme ?? _styleTheme))]}>
          <Text style={themeStyle('components_IncomingShareModal_21', { textColor: textColor }, (theme ?? _styleTheme))}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </DialogShell>
  );
};

export default IncomingShareModal;
