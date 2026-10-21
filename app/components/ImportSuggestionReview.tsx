import React, { useEffect, useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { ImportReviewSuggestion } from '../../server/src/types';

export default function ImportSuggestionReview({ backendUrl, headers, onConfirmed, onReviewItem, styles }: {
  backendUrl: string; headers: Record<string, string>; styles: Record<string, any>;
  onConfirmed: (assigned: Array<{ id: string; tripId: string; itemType: string }>) => Promise<void> | void;
  onReviewItem: (id: string) => void;
}) {
  const scope = `${backendUrl}:${JSON.stringify(headers)}`;
  const current = useRef(scope); current.current = scope;
  const [preview, setPreview] = useState<{ scope: string; suggestions: ImportReviewSuggestion[]; needsIndividualReview: number; remaining: number; nextAfter?: string | null } | null>(null);
  const [selected, setSelected] = useState(new Set<string>());
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [failures, setFailures] = useState<Array<{ id: string; reason: string }>>([]);
  const lock = useRef<string | null>(null);
  useEffect(() => {
    lock.current = null; setBusy(false); setPreview(null); setSelected(new Set()); setNotice(''); setFailures([]);
    return () => { if (current.current === scope) current.current = ''; };
  }, [scope]);
  const load = async (after?: string) => {
    if (lock.current === scope) return;
    lock.current = scope; setBusy(true); setNotice(''); setFailures([]);
    try {
      const response = await fetch(`${backendUrl}/api/ingestion/review-suggestions${after ? `?after=${encodeURIComponent(after)}` : ''}`, { headers });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Matching bookings could not load.');
      if (current.current !== scope) return;
      setPreview({ ...body, scope }); setSelected(new Set());
    } catch (error) { if (current.current === scope) setNotice((error as Error).message); }
    finally { if (lock.current === scope) lock.current = null; if (current.current === scope) setBusy(false); }
  };
  const confirm = async () => {
    if (lock.current === scope || preview?.scope !== scope || !selected.size) return;
    lock.current = scope; setBusy(true); setNotice('');
    const rows = preview.suggestions.filter(row => selected.has(row.itemId));
    try {
      const response = await fetch(`${backendUrl}/api/ingestion/review-suggestions/confirm`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestions: rows.map(({ itemId, tripId, reviewVersion }) => ({ itemId, tripId, reviewVersion })) }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'The result could not be confirmed. Refresh matching bookings before retrying.');
      if (current.current !== scope) return;
      const assigned: Array<{ id: string; tripId: string; itemType: string }> = body.assigned ?? [];
      const done = new Set(assigned.map(row => row.id));
      setPreview(previous => previous && { ...previous, suggestions: previous.suggestions.filter(row => !done.has(row.itemId)) });
      setSelected(new Set()); setFailures(body.failed ?? []);
      setNotice(`${assigned.length} booking${assigned.length === 1 ? '' : 's'} confirmed.${body.failed?.length ? ' Some bookings need another look below.' : ''}`);
      await onConfirmed(assigned);
    } catch (error) { if (current.current === scope) setNotice((error as Error).message); }
    finally { if (lock.current === scope) lock.current = null; if (current.current === scope) setBusy(false); }
  };
  const rows = preview?.scope === scope ? preview.suggestions : [];
  return <View style={{ gap: 8, marginVertical: 12 }}>
    <TouchableOpacity accessibilityRole="button" style={[styles.button, { minHeight: 44 }]} disabled={busy} onPress={() => void load()}>
      <Text style={styles.buttonText}>{busy ? 'Checking bookings…' : preview ? 'Refresh matching bookings' : 'Review matching bookings'}</Text>
    </TouchableOpacity>
    {notice ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.helperText}>{notice}</Text> : null}
    {preview?.scope === scope && <>
      <Text style={styles.helperText}>Confirming adds these bookings and their reported costs to shared trips. Review the details before selecting.</Text>
      {rows.length ? <TouchableOpacity accessibilityRole="checkbox" aria-checked={selected.size === rows.length} accessibilityState={{ checked: selected.size === rows.length, disabled: busy }}
        accessibilityLabel="Select all matching suggestions" style={{ minHeight: 44, justifyContent: 'center' }} disabled={busy}
        onPress={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map(row => row.itemId)))}><Text style={styles.helperText}>{selected.size === rows.length ? 'Clear selection' : 'Select all suggestions'}</Text></TouchableOpacity> : <Text style={styles.helperText}>No uniquely matched bookings in this batch. Review the queued items individually.</Text>}
      {rows.map(row => <View key={row.itemId} style={{ gap: 4, paddingVertical: 8 }}>
        <TouchableOpacity accessibilityRole="checkbox" accessibilityLabel={`Select ${row.label} for ${row.tripName}`} aria-checked={selected.has(row.itemId)} accessibilityState={{ checked: selected.has(row.itemId), disabled: busy }}
          style={{ minHeight: 44, justifyContent: 'center' }} disabled={busy} onPress={() => setSelected(previous => { const next = new Set(previous); if (next.has(row.itemId)) next.delete(row.itemId); else next.add(row.itemId); return next; })}>
          <Text style={styles.flightTitle}>{selected.has(row.itemId) ? '✓ ' : '○ '}{row.label} → {row.tripName}</Text>
        </TouchableOpacity>
        <Text style={styles.helperText}>{row.startDate || 'Date to check'}{row.endDate && row.endDate !== row.startDate ? ` – ${row.endDate}` : ''} · {row.amount === null ? 'Amount not provided — check before adding' : `${row.currency ?? ''} ${row.amount}`}</Text>
        <Text style={styles.helperText}>{row.reasons.join('. ')}</Text>
        {row.forwarderTrust === 'uncertain' && <Text style={styles.helperText}>We couldn’t confirm who forwarded this — check it before adding.</Text>}
        <TouchableOpacity accessibilityRole="button" style={{ minHeight: 44 }} disabled={busy} onPress={() => onReviewItem(row.itemId)}><Text style={styles.helperText}>Review booking details</Text></TouchableOpacity>
      </View>)}
      {rows.length > 0 && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Confirm ${selected.size} selected suggestions`} disabled={busy || !selected.size} style={[styles.button, { minHeight: 44 }]} onPress={() => void confirm()}><Text style={styles.buttonText}>{busy ? 'Confirming…' : selected.size === rows.length ? `Confirm all suggestions (${selected.size})` : `Confirm ${selected.size} selected suggestion${selected.size === 1 ? '' : 's'}`}</Text></TouchableOpacity>}
      {failures.map(row => <View key={row.id}><Text accessibilityRole="alert" style={styles.warningText}>{row.reason}</Text><TouchableOpacity accessibilityRole="button" style={{ minHeight: 44 }} onPress={() => onReviewItem(row.id)}><Text style={styles.helperText}>Review this booking</Text></TouchableOpacity></View>)}
      {preview.needsIndividualReview > 0 && <Text style={styles.helperText}>{preview.needsIndividualReview} booking(s) need an individual trip choice or detail check.</Text>}
      {preview.remaining > 0 && preview.nextAfter && <TouchableOpacity accessibilityRole="button" disabled={busy} style={{ minHeight: 44 }} onPress={() => void load(preview.nextAfter!)}><Text style={styles.helperText}>Review next batch ({preview.remaining} remaining)</Text></TouchableOpacity>}
    </>}
  </View>;
}
