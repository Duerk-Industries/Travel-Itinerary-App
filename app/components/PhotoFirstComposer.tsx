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
import { ActivityIndicator, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { uploadBlogFiles, type PickedMediaFile } from '../utils/blogUpload';
import { formatDateLong } from '../utils/formatDateLong';

type Ctx = { backendUrl: string; headers: Record<string, string>; tripId: string };

type Props = {
  visible: boolean;
  files: PickedMediaFile[];
  dayDates: string[];
  context: Ctx;
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
  visible, files, dayDates, context, onClose, onCommitted,
  styles, theme, textColor = '#111827', mutedColor = '#6b7280', borderColor = '#ccd4df',
  backgroundColor = '#ffffff', testID = 'photo-composer',
}) => {
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
        const next: Record<string, string | null> = {};
        for (const bucket of grouped.buckets ?? []) {
          for (const clientId of bucket.clientIds) next[clientId] = bucket.dayDate;
        }
        for (const clientId of grouped.unassigned ?? []) next[clientId] = null;
        const oor: Record<string, string> = {};
        for (const item of grouped.outOfRange ?? []) { next[item.clientId] = null; oor[item.clientId] = item.capturedAt; }
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
  }, [visible, context.backendUrl, context.tripId, clientFiles]);

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
    for (const [dayDate, group] of byDay) {
      const result = await uploadBlogFiles(context, dayDate, group, {
        onProgress: (current) => setProgress({ current: done + current, total: included.length }),
      });
      succeeded += result.succeeded;
      failed += result.failed;
      done += group.length;
      if (result.quotaBlocked) { quotaBlocked = true; break; }
    }
    setProgress(null);
    onCommitted({ succeeded, failed, quotaBlocked });
  };

  const dayChips = (clientId: string) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
      {dayDates.map((dayDate) => {
        const active = assignment[clientId] === dayDate;
        return (
          <TouchableOpacity
            key={dayDate}
            testID={`${testID}-file-${clientId}-day-${dayDate}`}
            accessibilityRole="button"
            onPress={() => setDay(clientId, dayDate)}
            style={{
              borderWidth: 1, borderColor: active ? (theme?.colors?.link ?? '#0ea5e9') : borderColor,
              backgroundColor: active ? (theme?.colors?.link ?? '#0ea5e9') : 'transparent',
              borderRadius: 14, paddingVertical: 4, paddingHorizontal: 9, marginRight: 6,
            }}
          >
            <Text style={{ color: active ? '#fff' : textColor, fontSize: 12 }}>{formatDateLong(dayDate)}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  const fileRow = (file: any) => {
    const oor = outOfRange[file.clientId];
    return (
      <View key={file.clientId} testID={`${testID}-file-${file.clientId}`} style={{ borderTopWidth: 1, borderTopColor: borderColor, paddingVertical: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: textColor, fontSize: 13, flex: 1 }} numberOfLines={1}>{file.name || 'photo'}</Text>
          <TouchableOpacity testID={`${testID}-file-${file.clientId}-remove`} accessibilityRole="button" accessibilityLabel="Remove this photo" onPress={() => removeFile(file.clientId)} style={{ paddingHorizontal: 8, minHeight: 28, justifyContent: 'center' }}>
            <Text style={{ color: mutedColor, fontSize: 15 }}>✕</Text>
          </TouchableOpacity>
        </View>
        {oor ? (
          <Text style={{ color: '#b45309', fontSize: 11, marginTop: 2 }}>
            Taken {formatDateLong(oor)} — outside this trip's dates. Pick a day or remove it.
          </Text>
        ) : file.capturedAt ? (
          <Text style={{ color: mutedColor, fontSize: 11, marginTop: 2 }}>Taken {formatDateLong(file.capturedAt)}</Text>
        ) : (
          <Text style={{ color: mutedColor, fontSize: 11, marginTop: 2 }}>No capture date — choose a day.</Text>
        )}
        {dayChips(file.clientId)}
      </View>
    );
  };

  const placedByDay = dayDates
    .map((dayDate) => ({ dayDate, items: included.filter((f) => assignment[f.clientId] === dayDate) }))
    .filter((group) => group.items.length > 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
        <View testID={testID} style={{ backgroundColor, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '88%', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ color: textColor, fontSize: 17, fontWeight: '700' }}>
              Add {included.length} photo{included.length === 1 ? '' : 's'}
            </Text>
            <TouchableOpacity testID={`${testID}-close`} accessibilityRole="button" accessibilityLabel="Close" onPress={onClose}>
              <Text style={{ color: mutedColor, fontSize: 18 }}>✕</Text>
            </TouchableOpacity>
          </View>

          {phase === 'grouping' ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={theme?.colors?.link ?? '#0ea5e9'} /></View>
          ) : phase === 'error' ? (
            <View style={{ paddingVertical: 24 }}>
              <Text style={{ color: textColor, fontSize: 14 }}>{message}</Text>
              <TouchableOpacity style={[styles.button, { marginTop: 12 }]} onPress={onClose}><Text style={styles.buttonText}>Close</Text></TouchableOpacity>
            </View>
          ) : (
            <>
              <Text testID={`${testID}-headroom`} style={{ color: overQuota ? '#b91c1c' : mutedColor, fontSize: 12, marginBottom: 8 }}>
                {headroom
                  ? overQuota
                    ? (headroom.entitlementActive
                        ? `This batch needs ${mb(neededBytes)} but only ${mb(headroom.availableBytes)} is free. Remove some, or add storage.`
                        : 'Photo storage is not active on your account.')
                    : `Using ${mb(neededBytes)} of ${mb(headroom.availableBytes)} available`
                  : `This batch is about ${mb(neededBytes)}`}
              </Text>

              <ScrollView style={{ flexGrow: 0 }}>
                {unplaced.length > 0 ? (
                  <Text testID={`${testID}-unplaced-count`} style={{ color: '#b45309', fontSize: 12, fontWeight: '600', marginBottom: 4 }}>
                    {unplaced.length} photo{unplaced.length === 1 ? '' : 's'} still need a day
                  </Text>
                ) : null}
                {unplaced.map(fileRow)}

                {placedByDay.map((group) => (
                  <View key={group.dayDate} testID={`${testID}-day-${group.dayDate}`} style={{ marginTop: 12 }}>
                    <Text testID={`${testID}-day-${group.dayDate}-count`} style={{ color: textColor, fontSize: 13, fontWeight: '700' }}>
                      {`${formatDateLong(group.dayDate)} · ${group.items.length} photo${group.items.length === 1 ? '' : 's'}`}
                    </Text>
                    {group.items.map(fileRow)}
                  </View>
                ))}
              </ScrollView>

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                <TouchableOpacity
                  testID={`${testID}-commit`}
                  accessibilityRole="button"
                  style={[styles.button, !canCommit || phase === 'committing' ? { opacity: 0.5 } : null]}
                  disabled={!canCommit || phase === 'committing'}
                  onPress={commit}
                >
                  {phase === 'committing'
                    ? <Text style={styles.buttonText}>{progress ? `${progress.current}/${progress.total}…` : 'Adding…'}</Text>
                    : <Text style={styles.buttonText}>Add to blog</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, { backgroundColor: theme?.colors?.surfaceMuted ?? '#e5e7eb' }]} onPress={onClose} disabled={phase === 'committing'}>
                  <Text style={{ color: textColor }}>Cancel</Text>
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
