// @ts-nocheck
import { resolveComponentTheme as resolveStyleTheme, themeStyle } from '../theme/theme';


import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
// @ts-nocheck
// Slice 2 of the photo-first composer (A2), docs/trip-blog-social-prd.md §5.1 / architecture §5.3.
//
// The user multi-selects photos in one action; this groups them by the day each was taken
// (captured_at, plumbed by slice 1) via the stateless POST /blog/media/group, and shows the count
// per day *before* anything uploads. Rules the server can't enforce and this must:
//   FR-A2.2  a photo with no capture date lands in "Needs a day" and is never auto-assigned.
//   FR-A2.3  a photo taken outside the trip's dates is flagged and needs an explicit choice.
//   FR-A2.4  the storage-headroom conversation happens here, before commit — not mid-upload.
//
// On commit it drives the existing uploadBlogFiles() batch once per day bucket.
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Modal from './KeyboardAwareModal';
import { uploadBlogFiles, type PickedMediaFile } from '../utils/blogUpload';
import { formatDateLong } from '../utils/formatDateLong';

type Ctx = { backendUrl: string; headers: Record<string, string>; tripId: string };

type Props = {
  visible: boolean;
  files: PickedMediaFile[];
  dayDates: string[];
  context: Ctx;
  // When the composer is opened from a specific day's "+ Photo/Video" button, photos the server
  // can't place by capture date default to that day instead of blocking commit.
  defaultDayDate?: string;
  defaultTags?: string[];
  onClose: () => void;
  onCommitted: (summary: { succeeded: number; failed: number; quotaBlocked: boolean }) => void;
  styles: any;
  theme?: any;
  textColor?: string;
  mutedColor?: string;
  borderColor?: string;
  backgroundColor?: string;
  testID?: string;
};

const MB = 1024 * 1024;
const mb = (bytes: number): string => `${(bytes / MB).toFixed(1)} MB`;

const PhotoFirstComposer: React.FC<Props> = ({
  visible, files, dayDates, context, defaultDayDate, defaultTags = [], onClose, onCommitted,
  styles, theme: _providedTheme, textColor: _textColorOverride, mutedColor: _mutedColorOverride, borderColor: _borderColorOverride,
  backgroundColor: _backgroundColorOverride, testID = 'photo-composer',
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const textColor = _textColorOverride ?? themeStyle('components_PhotoFirstComposer_36', {  }, (theme ?? _styleTheme));
  const mutedColor = _mutedColorOverride ?? themeStyle('components_PhotoFirstComposer_37', {  }, (theme ?? _styleTheme));
  const borderColor = _borderColorOverride ?? themeStyle('components_PhotoFirstComposer_38', {  }, (theme ?? _styleTheme));
  const backgroundColor = _backgroundColorOverride ?? themeStyle('components_PhotoFirstComposer_39', {  }, (theme ?? _styleTheme));
  // Stable per-session id for each picked file — the grouping API and every assignment key off it.
  const clientFiles = useMemo(
    () => files.map((file, index) => ({ ...file, clientId: `f${index}` })),
    [files]
  );

  const [phase, setPhase] = useState<'idle' | 'grouping' | 'ready' | 'error' | 'committing'>('idle');
  const [assignment, setAssignment] = useState<Record<string, string | null>>({});
  const [outOfRange, setOutOfRange] = useState<Record<string, string>>({}); // clientId -> capturedAt
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [headroom, setHeadroom] = useState<{ availableBytes: number; entitlementActive: boolean } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  // The full trip day list from the grouping response — so a photo can be placed on ANY trip
  // day, not just the ones the blog tab has paged in (the `dayDates` prop). Falls back to the prop.
  const [allDayDates, setAllDayDates] = useState<string[]>([]);
  const pickableDays = allDayDates.length ? allDayDates : dayDates;

  useEffect(() => {
    if (!visible) return;
    setPhase('grouping');
    setMessage(null);
    setRemoved(new Set());
    let cancelled = false;
    (async () => {
      try {
        const [groupRes, storageRes] = await Promise.all([
          fetch(`${context.backendUrl}/api/trips/${context.tripId}/blog/media/group`, {
            method: 'POST',
            headers: { ...context.headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidates: clientFiles.map((f) => ({ clientId: f.clientId, capturedAt: f.capturedAt ?? null })) }),
          }),
          fetch(`${context.backendUrl}/api/account/blog-storage`, { headers: context.headers }),
        ]);
        if (cancelled) return;
        if (!groupRes.ok) {
          const body = await groupRes.json().catch(() => ({}));
          setMessage(body.error || 'Could not sort these photos by day.');
          setPhase('error');
          return;
        }
        const grouped = await groupRes.json();
        if (Array.isArray(grouped.dayDates) && grouped.dayDates.length) setAllDayDates(grouped.dayDates);
        const next: Record<string, string | null> = {};
        for (const bucket of grouped.buckets ?? []) {
          for (const clientId of bucket.clientIds) next[clientId] = bucket.dayDate;
        }
        const fallbackDay = typeof defaultDayDate === 'string' ? defaultDayDate : null;
        for (const clientId of grouped.unassigned ?? []) next[clientId] = fallbackDay;
        const oor: Record<string, string> = {};
        for (const item of grouped.outOfRange ?? []) { next[item.clientId] = fallbackDay; oor[item.clientId] = item.capturedAt; }
        setAssignment(next);
        setOutOfRange(oor);

        if (storageRes.ok) {
          const s = await storageRes.json();
          setHeadroom({ availableBytes: Number(s.availableBytes ?? 0), entitlementActive: Boolean(s.entitlementActive) });
        }
        setPhase('ready');
      } catch {
        if (!cancelled) { setMessage('Could not sort these photos by day.'); setPhase('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [visible, context.backendUrl, context.tripId, clientFiles, defaultDayDate]);

  // Free the web blob: URLs created for thumbnails once this batch is done with.
  useEffect(() => {
    if (visible) return;
    for (const file of clientFiles) {
      if (typeof file.previewUri === 'string' && file.previewUri.startsWith('blob:') && typeof URL !== 'undefined' && URL.revokeObjectURL) {
        URL.revokeObjectURL(file.previewUri);
      }
    }
  }, [visible, clientFiles]);

  const included = clientFiles.filter((f) => !removed.has(f.clientId));
  const neededBytes = included.reduce((sum, f) => sum + (Number(f.size) || 0), 0);
  const unplaced = included.filter((f) => !assignment[f.clientId]);
  const overQuota = !!headroom && (!headroom.entitlementActive || neededBytes > headroom.availableBytes);
  const canCommit = phase === 'ready' && included.length > 0 && unplaced.length === 0 && !overQuota;

  const setDay = (clientId: string, dayDate: string) =>
    setAssignment((current) => ({ ...current, [clientId]: dayDate }));
  const removeFile = (clientId: string) =>
    setRemoved((current) => new Set(current).add(clientId));

  const commit = async () => {
    setPhase('committing');
    setMessage(null);
    const byDay = new Map<string, PickedMediaFile[]>();
    for (const file of included) {
      const day = assignment[file.clientId];
      if (!day) continue;
      byDay.set(day, [...(byDay.get(day) ?? []), file]);
    }
    let succeeded = 0;
    let failed = 0;
    let quotaBlocked = false;
    let done = 0;
    const errors: string[] = [];
    for (const [dayDate, group] of byDay) {
      const result = await uploadBlogFiles(context, dayDate, group, {
        tags: defaultTags,
        onProgress: (current) => setProgress({ current: done + current, total: included.length }),
      });
      succeeded += result.succeeded;
      failed += result.failed;
      errors.push(...result.errors);
      done += group.length;
      if (result.quotaBlocked) { quotaBlocked = true; break; }
    }
    setProgress(null);
    // Keep the composer open on a partial/total failure so the user can see why and retry the
    // same selection instead of re-picking everything.
    if (failed > 0 && !quotaBlocked) {
      setMessage(errors[0] || `${failed} photo${failed === 1 ? '' : 's'} failed to upload.`);
      setPhase('ready');
      if (succeeded > 0) onCommitted({ succeeded, failed: 0, quotaBlocked: false });
      return;
    }
    onCommitted({ succeeded, failed, quotaBlocked });
  };

  const dayChips = (clientId: string) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={themeStyle('components_PhotoFirstComposer_1', {  }, (theme ?? _styleTheme))}>
      {pickableDays.map((dayDate) => {
        const active = assignment[clientId] === dayDate;
        return (
          <TouchableOpacity
            key={dayDate}
            testID={`${testID}-file-${clientId}-day-${dayDate}`}
            accessibilityRole="button"
            onPress={() => setDay(clientId, dayDate)}
            style={themeStyle('components_PhotoFirstComposer_2', { active: active, theme: theme, borderColor: borderColor }, (theme ?? _styleTheme))}
          >
            <Text style={themeStyle('components_PhotoFirstComposer_3', { active: active, textColor: textColor }, (theme ?? _styleTheme))}>{formatDateLong(dayDate)}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  const fileRow = (file: any) => {
    const oor = outOfRange[file.clientId];
    const isVideo = /^video\//i.test(String(file.mimeType || ''));
    return (
      <View key={file.clientId} testID={`${testID}-file-${file.clientId}`} style={themeStyle('components_PhotoFirstComposer_4', { borderColor: borderColor }, (theme ?? _styleTheme))}>
        <View style={themeStyle('components_PhotoFirstComposer_5', {  }, (theme ?? _styleTheme))}>
          {file.previewUri && !isVideo
            ? <Image source={{ uri: file.previewUri }} style={themeStyle('components_PhotoFirstComposer_6', {  }, (theme ?? _styleTheme))} resizeMode="cover" />
            : <Text style={themeStyle('components_PhotoFirstComposer_7', {  }, (theme ?? _styleTheme))}>{isVideo ? '🎞️' : '🖼️'}</Text>}
        </View>
        <View style={themeStyle('components_PhotoFirstComposer_8', {  }, (theme ?? _styleTheme))}>
        <View style={themeStyle('components_PhotoFirstComposer_9', {  }, (theme ?? _styleTheme))}>
          <Text style={themeStyle('components_PhotoFirstComposer_10', { textColor: textColor }, (theme ?? _styleTheme))} numberOfLines={1}>{file.name || 'photo'}</Text>
          <TouchableOpacity testID={`${testID}-file-${file.clientId}-remove`} accessibilityRole="button" accessibilityLabel="Remove this photo" onPress={() => removeFile(file.clientId)} style={themeStyle('components_PhotoFirstComposer_11', {  }, (theme ?? _styleTheme))}>
            <Text style={themeStyle('components_PhotoFirstComposer_12', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>✕</Text>
          </TouchableOpacity>
        </View>
        {oor ? (
          <Text style={themeStyle('components_PhotoFirstComposer_13', { theme: theme }, (theme ?? _styleTheme))}>
            Taken {formatDateLong(oor)} — outside this trip's dates. Pick a day or remove it.
          </Text>
        ) : file.capturedAt ? (
          <Text style={themeStyle('components_PhotoFirstComposer_14', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>Taken {formatDateLong(file.capturedAt)}</Text>
        ) : (
          <Text style={themeStyle('components_PhotoFirstComposer_15', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>No capture date — choose a day.</Text>
        )}
        {dayChips(file.clientId)}
        </View>
      </View>
    );
  };

  const placedByDay = pickableDays
    .map((dayDate) => ({ dayDate, items: included.filter((f) => assignment[f.clientId] === dayDate) }))
    .filter((group) => group.items.length > 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={themeStyle('components_PhotoFirstComposer_16', {  }, (theme ?? _styleTheme))}>
        <View testID={testID} style={themeStyle('components_PhotoFirstComposer_17', { backgroundColor: backgroundColor }, (theme ?? _styleTheme))}>
          <View style={themeStyle('components_PhotoFirstComposer_18', {  }, (theme ?? _styleTheme))}>
            <Text style={themeStyle('components_PhotoFirstComposer_19', { textColor: textColor }, (theme ?? _styleTheme))}>
              Add {included.length} photo{included.length === 1 ? '' : 's'}
            </Text>
            <TouchableOpacity testID={`${testID}-close`} accessibilityRole="button" accessibilityLabel="Close" onPress={onClose}>
              <Text style={themeStyle('components_PhotoFirstComposer_20', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>✕</Text>
            </TouchableOpacity>
          </View>

          {phase === 'grouping' ? (
            <View style={themeStyle('components_PhotoFirstComposer_21', {  }, (theme ?? _styleTheme))}><ActivityIndicator color={theme?.colors?.link ?? themeStyle('components_PhotoFirstComposer_40', {  }, (theme ?? _styleTheme))} /></View>
          ) : phase === 'error' ? (
            <View style={themeStyle('components_PhotoFirstComposer_22', {  }, (theme ?? _styleTheme))}>
              <Text style={themeStyle('components_PhotoFirstComposer_23', { textColor: textColor }, (theme ?? _styleTheme))}>{message}</Text>
              <TouchableOpacity style={[styles.button, themeStyle('components_PhotoFirstComposer_24', {  }, (theme ?? _styleTheme))]} onPress={onClose}><Text style={styles.buttonText}>Close</Text></TouchableOpacity>
            </View>
          ) : (
            <>
              <Text testID={`${testID}-headroom`} style={themeStyle('components_PhotoFirstComposer_25', { overQuota: overQuota, theme: theme, mutedColor: mutedColor }, (theme ?? _styleTheme))}>
                {headroom
                  ? overQuota
                    ? (headroom.entitlementActive
                        ? `This batch needs ${mb(neededBytes)} but only ${mb(headroom.availableBytes)} is free. Remove some, or add storage.`
                        : 'Photo storage is not active on your account.')
                    : `Using ${mb(neededBytes)} of ${mb(headroom.availableBytes)} available`
                  : `This batch is about ${mb(neededBytes)}`}
              </Text>
              {defaultTags.length ? <Text style={themeStyle('components_PhotoFirstComposer_26', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>Tagged: {defaultTags.map((tag) => `#${tag}`).join(' ')}</Text> : null}

              <ScrollView style={themeStyle('components_PhotoFirstComposer_27', {  }, (theme ?? _styleTheme))}>
                {unplaced.length > 0 ? (
                  <Text testID={`${testID}-unplaced-count`} style={themeStyle('components_PhotoFirstComposer_28', { theme: theme }, (theme ?? _styleTheme))}>
                    {unplaced.length} photo{unplaced.length === 1 ? '' : 's'} still need a day
                  </Text>
                ) : null}
                {unplaced.map(fileRow)}

                {placedByDay.map((group) => (
                  <View key={group.dayDate} testID={`${testID}-day-${group.dayDate}`} style={themeStyle('components_PhotoFirstComposer_29', {  }, (theme ?? _styleTheme))}>
                    <Text testID={`${testID}-day-${group.dayDate}-count`} style={themeStyle('components_PhotoFirstComposer_30', { textColor: textColor }, (theme ?? _styleTheme))}>
                      {`${formatDateLong(group.dayDate)} · ${group.items.length} photo${group.items.length === 1 ? '' : 's'}`}
                    </Text>
                    {group.items.map(fileRow)}
                  </View>
                ))}
              </ScrollView>

              {message ? (
                <Text testID={`${testID}-error`} style={themeStyle('components_PhotoFirstComposer_31', { theme: theme }, (theme ?? _styleTheme))}>{message}</Text>
              ) : null}

              <View style={themeStyle('components_PhotoFirstComposer_32', {  }, (theme ?? _styleTheme))}>
                <TouchableOpacity
                  testID={`${testID}-commit`}
                  accessibilityRole="button"
                  style={[styles.button, !canCommit || phase === 'committing' ? themeStyle('components_PhotoFirstComposer_33', {  }, (theme ?? _styleTheme)) : null]}
                  disabled={!canCommit || phase === 'committing'}
                  onPress={commit}
                >
                  {phase === 'committing'
                    ? <Text style={styles.buttonText}>{progress ? `${progress.current}/${progress.total}…` : 'Adding…'}</Text>
                    : <Text style={styles.buttonText}>Add to blog</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, themeStyle('components_PhotoFirstComposer_34', { theme: theme }, (theme ?? _styleTheme))]} onPress={onClose} disabled={phase === 'committing'}>
                  <Text style={themeStyle('components_PhotoFirstComposer_35', { textColor: textColor }, (theme ?? _styleTheme))}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

export default PhotoFirstComposer;
