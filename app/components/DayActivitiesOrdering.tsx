import IconText from './IconText';
import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { orderDayActivities } from '../../packages/domain/src/dayOrder';
import { MAX_OPTIMIZE_STOPS, moveStop, optimizeDayOrder, type LatLng, type OptimizeResult } from '../../packages/domain/src/dayRouteOptimizer';
import DayOrderRow from './DayOrderRow';

export type OrderableActivity = {
  id: string;
  name: string;
  status?: string | null;
  startTime?: string | null;
  lat?: number | null;
  lng?: number | null;
  dayPosition?: number | null;
  dayOrderPinned?: boolean;
};

type Props<T extends OrderableActivity> = {
  tripId: string;
  date: string;
  backendUrl: string;
  headers: Record<string, string>;
  /** Every activity on this day, in any order. This component orders them. */
  activities: readonly T[];
  /** The day's lodging, when it has coordinates. Offered as the start and end of the route. */
  lodgingAnchor?: LatLng | null;
  readOnly?: boolean;
  /** Called after any change is saved or a conflict is detected, so the parent can refetch. */
  onChanged: () => void;
  styles: Record<string, any>;
  /** Renders one activity row. `controls` holds the Move up / Move down buttons (null when not available). */
  renderRow: (activity: T, controls: React.ReactNode) => React.ReactNode;
};

type Notice = { kind: 'info' | 'error'; text: string } | null;

const km = (value: number): string => `${value < 10 ? value.toFixed(1) : Math.round(value)} km`;

const OPTIMIZE_REASON_COPY: Record<string, string> = {
  already_best: 'This order is already about as short as it gets.',
  nothing_to_move: 'Not enough stops with a map location to reorder.',
  too_few: 'Add at least two activities to reorder them.',
  too_many: `Optimizing works for up to ${MAX_OPTIMIZE_STOPS} stops in a day.`,
};

/**
 * One day's activity list with Move up / Move down and an "Optimize order" suggestion. The list order
 * is the same order the day's map pins are lettered in. Reordering is saved for the whole group, so
 * every change goes through a server check that the day hasn't changed underneath this screen.
 */
export default function DayActivitiesOrdering<T extends OrderableActivity>({
  tripId, date, backendUrl, headers, activities, lodgingAnchor, readOnly, onChanged, styles, renderRow,
}: Props<T>) {
  const _styleTheme = useStyleTheme();
  const [enabled, setEnabled] = useState(false);
  const [optimizationEnabled, setOptimizationEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [preview, setPreview] = useState<OptimizeResult | null>(null);
  const [useLodging, setUseLodging] = useState(true);
  const [undo, setUndo] = useState<{ previous: string[]; applied: string[]; pins: string[] } | null>(null);
  const busyRef = useRef(false);
  const layouts = useRef(new Map<string, { y: number; height: number }>());
  const drag = useRef<{ id: string; ids: string[]; pins: string[]; scope: string } | null>(null);

  const ordered = useMemo(() => orderDayActivities(activities), [activities]);
  const orderedIds = useMemo(() => ordered.map((a) => a.id), [ordered]);
  const nameById = useMemo(() => new Map(ordered.map((a) => [a.id, a.name])), [ordered]);
  const auth = headers.Authorization ?? '';
  const scope = `${backendUrl}:${tripId}:${date}:${auth}:${Boolean(readOnly)}`;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  useEffect(() => () => { if (scopeRef.current === scope) scopeRef.current = ''; }, [scope]);
  const pinnedIds = useMemo(() => ordered.filter(a => a.dayOrderPinned).map(a => a.id), [ordered]);
  const previewBase = useRef<{ ids: string[]; pins: string[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEnabled(false);
    setOptimizationEnabled(false);
    if (readOnly || typeof fetch !== 'function') return undefined;
    void Promise.resolve(fetch(`${backendUrl}/api/trips/${encodeURIComponent(tripId)}/planning-capabilities`, { headers }))
      .then(async (response) => {
        if (!response?.ok) return;
        const data = await response.json();
        if (!cancelled) { setEnabled(data?.dayOrder === true); setOptimizationEnabled(data?.optimizeOrder === true); }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl, tripId, auth, readOnly]);

  // A different day or trip never inherits another day's preview or undo.
  useEffect(() => {
    setPreview(null);
    setUndo(null);
    setNotice(null);
    drag.current = null;
    layouts.current.clear();
  }, [scope]);

  useEffect(() => { setPreview(null); previewBase.current = null; }, [activities]);

  const save = useCallback(async (next: string[], expected: string[], pins?: { pinnedIds: string[]; expectedPinnedIds: string[] }): Promise<boolean> => {
    if (busyRef.current || !enabled || readOnly) return false;
    const requestScope = scope;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`${backendUrl}/api/activities/day-order`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tripId, date, expectedIds: expected, orderedIds: next, ...pins }),
      });
      const data = await response.json().catch(() => ({}));
      if (scopeRef.current !== requestScope) return false;
      if (response.status === 409) {
        setPreview(null);
        setUndo(null);
        setNotice({ kind: 'error', text: data?.error || 'This day was changed by someone else. The latest order is shown.' });
        onChanged();
        return false;
      }
      if (!response.ok) {
        setNotice({ kind: 'error', text: data?.error || 'The order could not be saved. Nothing was changed.' });
        return false;
      }
      onChanged();
      return true;
    } catch {
      if (scopeRef.current === requestScope) setNotice({ kind: 'error', text: 'No connection. The save could not be confirmed. Refresh the day before trying again.' });
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [backendUrl, date, headers, onChanged, tripId, scope, enabled, readOnly]);

  const drop = async (target: string) => {
    const source = drag.current; drag.current = null;
    if (!source || source.scope !== scope || source.id === target || busyRef.current) return;
    const next = source.ids.filter(id => id !== source.id);
    next.splice(source.ids.indexOf(target), 0, source.id);
    setPreview(null); setUndo(null);
    if (await save(next, source.ids, { pinnedIds: source.pins, expectedPinnedIds: source.pins })) {
      setNotice({ kind: 'info', text: `Moved ${nameById.get(source.id) ?? 'activity'}.` });
    }
  };
  const endDrag = (offset?: number) => {
    const source = drag.current;
    if (source && offset !== undefined && layouts.current.has(source.id)) {
      const start = layouts.current.get(source.id)!;
      const center = start.y + start.height / 2 + offset;
      const target = source.ids.reduce((best, id) => {
        const row = layouts.current.get(id); const previous = layouts.current.get(best);
        return row && (!previous || Math.abs(row.y + row.height / 2 - center) < Math.abs(previous.y + previous.height / 2 - center)) ? id : best;
      }, source.id);
      void drop(target);
    } else drag.current = null;
  };
  const togglePin = async (activity: T) => {
    const next = activity.dayOrderPinned ? pinnedIds.filter(id => id !== activity.id) : [...pinnedIds, activity.id];
    setPreview(null); setUndo(null);
    if (await save(orderedIds, orderedIds, { pinnedIds: next, expectedPinnedIds: pinnedIds })) {
      setNotice({ kind: 'info', text: `${activity.name} ${activity.dayOrderPinned ? 'can move when optimizing' : 'will stay in place when optimizing'}.` });
    }
  };

  const move = async (id: string, delta: -1 | 1) => {
    const next = moveStop(orderedIds, id, delta);
    if (next.join() === orderedIds.join()) return;
    setPreview(null);
    setUndo(null);
    if (await save(next, orderedIds)) {
      setNotice({ kind: 'info', text: `Moved ${nameById.get(id) ?? 'activity'} ${delta < 0 ? 'up' : 'down'}.` });
    }
  };

  const showPreview = () => {
    if (!optimizationEnabled || !enabled || readOnly) return;
    previewBase.current = { ids: orderedIds, pins: pinnedIds };
    setNotice(null);
    const anchor = useLodging && lodgingAnchor ? lodgingAnchor : null;
    const result = optimizeDayOrder(
      ordered.map((a) => ({
        id: a.id,
        lat: a.lat,
        lng: a.lng,
        // A confirmed booking with a set time stays where it is; proposed ideas can move.
        fixed: a.dayOrderPinned || (a.status === 'Booked' && Boolean(a.startTime)),
      })),
      anchor,
    );
    if (!result.changed) {
      setPreview(null);
      setNotice({ kind: 'info', text: OPTIMIZE_REASON_COPY[result.reason ?? 'already_best'] ?? OPTIMIZE_REASON_COPY.already_best! });
      return;
    }
    setPreview(result);
  };

  const applyPreview = async () => {
    if (!preview) return;
    const previous = previewBase.current?.ids ?? orderedIds;
    const pins = previewBase.current?.pins ?? pinnedIds;
    if (await save(preview.order, previous, { pinnedIds: pins, expectedPinnedIds: pins })) {
      setUndo({ previous, applied: preview.order, pins });
      setNotice({ kind: 'info', text: `Order updated. Straight-line distance went from ${km(preview.beforeKm)} to ${km(preview.afterKm)}.` });
      setPreview(null);
    }
  };

  const undoOptimize = async () => {
    if (!undo) return;
    if (await save(undo.previous, undo.applied, { pinnedIds: undo.pins, expectedPinnedIds: undo.pins })) {
      setUndo(null);
      setNotice({ kind: 'info', text: 'Your previous order is back.' });
    }
  };

  const canReorder = enabled && !readOnly && ordered.length > 1;
  const hasCoordinates = ordered.filter((a) => typeof a.lat === 'number' && typeof a.lng === 'number').length;
  const touch = themeStyle('components_DayActivitiesOrdering_1', {  }, _styleTheme);

  return (
    <View>
      {canReorder && optimizationEnabled ? (
        <View testID="day-order-tools" style={themeStyle('components_DayActivitiesOrdering_2', {  }, _styleTheme)}>
          <TouchableOpacity
            testID="day-order-optimize"
            accessibilityRole="button"
            accessibilityLabel="Suggest a shorter order for this day"
            accessibilityState={{ disabled: busy || hasCoordinates < 2, busy }}
            disabled={busy || hasCoordinates < 2}
            style={[styles.dayInfoButton, touch, hasCoordinates < 2 ? themeStyle('components_DayActivitiesOrdering_3', {  }, _styleTheme) : null]}
            onPress={showPreview}
          >
            <Text style={styles.dayInfoButtonText}>Optimize order</Text>
          </TouchableOpacity>
          {hasCoordinates < 2 ? (
            <Text style={styles.helperText}>Optimizing needs at least two activities with a map location.</Text>
          ) : null}
          {lodgingAnchor && !preview ? (
            <TouchableOpacity
              testID="day-order-lodging-toggle"
              accessibilityRole="switch"
              accessibilityLabel="Start and end at your lodging"
              aria-checked={useLodging}
              accessibilityState={{ checked: useLodging }}
              style={touch}
              onPress={() => setUseLodging((value) => !value)}
            >
              <IconText style={styles.helperText}>{useLodging ? '✓ ' : '○ '}Start and end at your lodging</IconText>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {preview && optimizationEnabled ? (
        <View testID="day-order-preview" style={themeStyle('components_DayActivitiesOrdering_4', {  }, _styleTheme)} accessibilityLabel="Suggested order">
          <Text style={styles.flightTitle}>Suggested order</Text>
          <Text style={styles.helperText}>
            {`Straight-line distance: ${km(preview.beforeKm)} now, ${km(preview.afterKm)} suggested. These are rough distances, not walking or driving times, and they don't check opening hours.`}
          </Text>
          {preview.order.map((id, index) => (
            <Text key={id} style={styles.cellText}>{`${index + 1}. ${nameById.get(id) ?? id}${preview.keptInPlace.includes(id) ? ' (stays here)' : ''}`}</Text>
          ))}
          {preview.keptInPlace.length ? (
            <Text style={styles.helperText}>Pinned stops, booked activities with a set time and activities without a map location stay where they are.</Text>
          ) : null}
          <View style={themeStyle('components_DayActivitiesOrdering_5', {  }, _styleTheme)}>
            <TouchableOpacity
              testID="day-order-apply"
              accessibilityRole="button"
              accessibilityLabel="Use this order"
              disabled={busy}
              style={[styles.dayInfoButton, touch, themeStyle('components_DayActivitiesOrdering_6', {  }, _styleTheme)]}
              onPress={applyPreview}
            >
              <Text style={styles.dayInfoButtonText}>{busy ? 'Saving…' : 'Use this order'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="day-order-cancel"
              accessibilityRole="button"
              accessibilityLabel="Keep my order"
              disabled={busy}
              style={[styles.dayInfoButton, touch, themeStyle('components_DayActivitiesOrdering_7', {  }, _styleTheme)]}
              onPress={() => setPreview(null)}
            >
              <Text style={styles.dayInfoButtonText}>Keep my order</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {notice ? (
        <View style={themeStyle('components_DayActivitiesOrdering_8', {  }, _styleTheme)}>
          <Text
            testID="day-order-notice"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={notice.kind === 'error' ? styles.warningText : styles.helperText}
          >
            {notice.text}
          </Text>
          {undo && notice.kind === 'info' ? (
            <TouchableOpacity
              testID="day-order-undo"
              accessibilityRole="button"
              accessibilityLabel="Undo the new order"
              disabled={busy}
              style={[styles.dayInfoButton, touch]}
              onPress={undoOptimize}
            >
              <Text style={styles.dayInfoButtonText}>Undo</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {ordered.map((activity, index) => <DayOrderRow key={activity.id} id={activity.id} name={activity.name}
        disabled={!canReorder || busy} onStart={id => { drag.current = { id, ids: orderedIds, pins: pinnedIds, scope }; }}
        onDrop={id => void drop(id)} onEnd={endDrag}
        onLayout={(id, y, height) => { layouts.current.set(id, themeStyle('components_DayActivitiesOrdering_9', { y: y, height: height }, _styleTheme)); }}>
        {
        renderRow(
          activity,
          canReorder ? (
            <View style={themeStyle('components_DayActivitiesOrdering_10', {  }, _styleTheme)}>
              <TouchableOpacity testID={`day-order-pin-${activity.id}`} accessibilityRole="switch"
                accessibilityLabel={`Keep ${activity.name} in place when optimizing`}
                aria-checked={Boolean(activity.dayOrderPinned)}
                accessibilityState={{ checked: Boolean(activity.dayOrderPinned), disabled: busy }} disabled={busy}
                style={touch} onPress={() => void togglePin(activity)}>
                <Text style={styles.dayInfoButtonText}>{activity.dayOrderPinned ? 'Unpin' : 'Pin'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID={`day-order-up-${activity.id}`}
                accessibilityRole="button"
                accessibilityLabel={`Move ${activity.name} up`}
                accessibilityState={{ disabled: busy || index === 0 }}
                disabled={busy || index === 0}
                style={[touch, index === 0 ? themeStyle('components_DayActivitiesOrdering_11', {  }, _styleTheme) : null]}
                onPress={() => move(activity.id, -1)}
              >
                <IconText style={styles.dayInfoButtonText}>↑</IconText>
              </TouchableOpacity>
              <TouchableOpacity
                testID={`day-order-down-${activity.id}`}
                accessibilityRole="button"
                accessibilityLabel={`Move ${activity.name} down`}
                accessibilityState={{ disabled: busy || index === ordered.length - 1 }}
                disabled={busy || index === ordered.length - 1}
                style={[touch, index === ordered.length - 1 ? themeStyle('components_DayActivitiesOrdering_12', {  }, _styleTheme) : null]}
                onPress={() => move(activity.id, 1)}
              >
                <IconText style={styles.dayInfoButtonText}>↓</IconText>
              </TouchableOpacity>
            </View>
          ) : null,
        )}</DayOrderRow>,
      )}
    </View>
  );
}
