// @ts-nocheck
// Mounted once near the top of app/App.tsx (see useShareIntent's own requirement to run before
// other providers). Surfaces whenever the OS reports a pending "send to WanderBunnies" share —
// lets the traveler confirm which trip/day it belongs to, preview what was shared, add an
// optional message, then uploads via the same app/utils/blogUpload.ts plumbing the in-tab
// "+ Photo/Video" button uses.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DialogShell from './DialogShell';
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
};

const IncomingShareModal = ({ backendUrl, headers, trips = [], activeTripId, styles, theme }: IncomingShareModalProps) => {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const [selectedTripId, setSelectedTripId] = useState(activeTripId ?? null);
  const [dayDate, setDayDate] = useState(todayDate());
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const textColor = theme?.colors?.text ?? '#111827';
  const mutedColor = theme?.colors?.textMuted ?? '#6b7280';
  const borderColor = theme?.colors?.border ?? '#ccd4df';
  const surfaceColor = theme?.colors?.surface ?? '#ffffff';

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

  const submit = async () => {
    if (!selectedTripId || !isValidDayDate(dayDate) || submitting) return;
    setSubmitting(true);
    try {
      const context = { backendUrl, headers, tripId: selectedTripId };
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
    <DialogShell visible title="Add to trip blog" styles={styles} onClose={close} useNativeModal cardStyle={{ maxWidth: 480, width: '92%', maxHeight: '85%' }}>
      <ScrollView style={{ maxHeight: 420 }}>
        <Text style={{ color: mutedColor, marginBottom: 10 }}>
          {files.length} {files.length === 1 ? 'item' : 'items'} shared from your device.
        </Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {files.map((file, index) => (
            <View key={file.path ?? index} style={{ width: 64, height: 64, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor, backgroundColor: surfaceColor, alignItems: 'center', justifyContent: 'center' }}>
              {isVideoMimeType(file.mimeType) ? (
                <Text style={{ fontSize: 20 }}>🎬</Text>
              ) : (
                <Image source={{ uri: file.path }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              )}
            </View>
          ))}
        </View>

        {trips.length > 1 ? (
          <>
            <Text style={{ color: textColor, fontWeight: '700', marginBottom: 6 }}>Trip</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {trips.map((trip) => (
                <TouchableOpacity
                  key={trip.id}
                  testID={`share-trip-${trip.id}`}
                  accessibilityRole="button"
                  onPress={() => { setSelectedTripId(trip.id); setDayDate(defaultDayDateFor(trip)); }}
                  style={[styles?.button, { paddingVertical: 5, paddingHorizontal: 10, backgroundColor: trip.id === selectedTripId ? undefined : (theme?.colors?.surfaceMuted ?? '#e5e7eb') }]}
                >
                  <Text style={trip.id === selectedTripId ? styles?.buttonText : { color: textColor }}>{trip.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}

        <Text style={{ color: textColor, fontWeight: '700', marginBottom: 6 }}>Day (YYYY-MM-DD)</Text>
        <TextInput
          testID="share-day-input"
          value={dayDate}
          onChangeText={setDayDate}
          placeholder="2026-08-01"
          placeholderTextColor={mutedColor}
          style={{ borderWidth: 1, borderColor, borderRadius: 8, padding: 8, color: textColor, marginBottom: 12 }}
        />

        <Text style={{ color: textColor, fontWeight: '700', marginBottom: 6 }}>Message (optional)</Text>
        <TextInput
          testID="share-message-input"
          multiline
          value={message}
          onChangeText={setMessage}
          placeholder={files.length > 1 ? 'A note about today…' : 'Add a caption…'}
          placeholderTextColor={mutedColor}
          style={{ minHeight: 70, borderWidth: 1, borderColor, borderRadius: 8, padding: 8, textAlignVertical: 'top', color: textColor, marginBottom: 4 }}
        />
        <Text style={{ color: mutedColor, fontSize: 12, marginBottom: 12 }}>
          {files.length > 1 ? 'With multiple items, this becomes a general message for the day.' : 'With a single item, this becomes its caption.'}
        </Text>
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <TouchableOpacity
          testID="share-submit"
          accessibilityRole="button"
          disabled={submitting || !selectedTripId || !isValidDayDate(dayDate)}
          onPress={submit}
          style={styles?.button}
        >
          {submitting ? <ActivityIndicator /> : <Text style={styles?.buttonText}>Add to trip blog</Text>}
        </TouchableOpacity>
        <TouchableOpacity testID="share-cancel" accessibilityRole="button" disabled={submitting} onPress={close} style={[styles?.button, { backgroundColor: theme?.colors?.surfaceMuted ?? '#e5e7eb' }]}>
          <Text style={{ color: textColor }}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </DialogShell>
  );
};

export default IncomingShareModal;
