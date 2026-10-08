import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { AppTheme } from '../../theme/theme';

/**
 * Admin → Analytics (docs/implementation-plans/analytics-upgrade.md Phase 5): five aggregate
 * views over consenting users. Every view shows its definition, population, window and
 * freshness; counts under the minimum cohort arrive from the server as null and render "—".
 */

type Suppressible = { value: number | null; suppressed: boolean };
type View_ = 'adoption' | 'cost' | 'reliability' | 'platform' | 'trip_phase';
const WINDOWS = [7, 30, 90] as const;
const VIEWS: Array<{ key: View_; label: string }> = [
  { key: 'adoption', label: 'Feature adoption' },
  { key: 'cost', label: 'Cost' },
  { key: 'reliability', label: 'Reliability' },
  { key: 'platform', label: 'Platform mix' },
  { key: 'trip_phase', label: 'Trip phase' },
];

const fetchAdmin = async (backendUrl: string, headers: Record<string, string>, path: string) => {
  const res = await fetch(`${backendUrl}/api/admin${path}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string })?.error ?? `HTTP ${res.status}`);
  }
  return res;
};

const count = (s: Suppressible | undefined | null): string => (!s || s.value === null ? '—' : String(s.value));
const pct = (x: number | null | undefined): string => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`);
const usd = (micros: number | null | undefined): string => (micros === null || micros === undefined ? '—' : `$${(micros / 1_000_000).toFixed(2)}`);

export const AnalyticsSection: React.FC<{ backendUrl: string; headers: Record<string, string>; theme: AppTheme }> = ({
  backendUrl,
  headers,
  theme,
}) => {
  const [view, setView] = useState<View_>('adoption');
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const [report, setReport] = useState<any>(null);
  const [reliability, setReliability] = useState<any>(null);
  const [cost, setCost] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (view === 'cost') {
        const month = new Date().toISOString().slice(0, 7);
        setCost(await (await fetchAdmin(backendUrl, headers, `/costs/ledger?month=${month}`)).json());
      } else if (view === 'reliability') {
        setReliability(await (await fetchAdmin(backendUrl, headers, `/analytics/reliability?days=${days}`)).json());
      } else {
        setReport(await (await fetchAdmin(backendUrl, headers, `/analytics/report?days=${days}`)).json());
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, headers, view, days]);

  useEffect(() => { void load(); }, [load]);

  const exportCsv = async () => {
    setExportMessage(null);
    try {
      const csvView = view === 'trip_phase' ? 'trip_phase' : view;
      const text = await (await fetchAdmin(backendUrl, headers, `/analytics/export.csv?days=${days}&view=${csvView}`)).text();
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `wanderbunnies-${csvView}-${days}d.csv`;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ message: text, title: `WanderBunnies ${csvView} export` });
      }
      setExportMessage('Exported. Downloads are recorded in the audit log.');
    } catch (e) {
      setExportMessage((e as Error).message);
    }
  };

  const c = theme.colors;
  const Row = ({ cells, header }: { cells: string[]; header?: boolean }) => (
    <View style={[styles.row, { borderColor: c.border }]}>
      {cells.map((cell, i) => (
        <Text key={i} style={[styles.cell, i === 0 && styles.firstCell, { color: header ? c.textMuted : c.text }, header && styles.headerCell]}>{cell}</Text>
      ))}
    </View>
  );
  const Note = ({ children }: { children: React.ReactNode }) => <Text style={[styles.note, { color: c.textMuted }]}>{children}</Text>;
  const Heading = ({ children }: { children: React.ReactNode }) => <Text style={[styles.heading, { color: c.text }]}>{children}</Text>;

  const meta = report?.meta;
  const definitions = meta?.definitions ?? {};
  const MetaBlock = () => meta ? (
    <View style={styles.meta} testID="admin-analytics-meta">
      <Note>{definitions.population}</Note>
      <Note>{`Window: last ${meta.windowDays} days (UTC) · ${meta.eventsScanned} events · freshest event ${meta.latestReceivedAt ?? 'none'} · metrics ${meta.metricVersion}`}</Note>
      <Note>{`Counts under ${meta.minCohort} accounts are hidden (—).`}</Note>
      {meta.truncated ? <Text style={[styles.note, { color: c.error }]}>Truncated: more events than one report reads. Move to daily rollups.</Text> : null}
    </View>
  ) : null;

  const renderBody = () => {
    if (view === 'cost' && cost) {
      return (
        <View testID="admin-analytics-cost">
          <Note>{`Provider spend settled in the cost ledger for ${cost.windowKey}. Estimates from configured prices; invoiced figures only appear after reconciliation.`}</Note>
          <Row header cells={['Total estimated', 'Attempts', 'Unknown price', 'Attributed to accounts', 'Priced attempts']} />
          <Row cells={[usd(cost.totals.estimatedMicros), String(cost.totals.attempts), String(cost.totals.unknownAttempts), pct(cost.coverage.attributionRatio), pct(cost.coverage.pricingRatio)]} />
          <Heading>Per account (direct cost)</Heading>
          <Row header cells={['Accounts', 'Median', 'p95', 'Max']} />
          <Row cells={[String(cost.directCostPerUser.count), usd(cost.directCostPerUser.medianMicros), usd(cost.directCostPerUser.p95Micros), usd(cost.directCostPerUser.maxMicros)]} />
          <Heading>By provider</Heading>
          <Row header cells={['Provider', 'Estimated', 'Attempts', 'Unknown', 'Failed']} />
          {cost.byProvider.map((p: any) => <Row key={p.provider} cells={[p.provider, usd(p.estimatedMicros), String(p.attempts), String(p.unknownAttempts), String(p.failedAttempts)]} />)}
          {cost.reconciliation.length ? <>
            <Heading>Invoice reconciliation</Heading>
            <Row header cells={['Provider', 'Invoiced (net)', 'Ledger', 'Variance', 'Within 5%']} />
            {cost.reconciliation.map((r: any) => <Row key={r.provider} cells={[r.provider, usd(r.invoicedNetUsdMicros), usd(r.ledgerEstimatedMicros), pct(r.varianceRatio), r.withinTolerance ? 'yes' : 'no'] } />)}
          </> : <Note>No invoices recorded for this month yet.</Note>}
        </View>
      );
    }
    if (view === 'reliability' && reliability) {
      return (
        <View testID="admin-analytics-reliability">
          <Heading>Server latency</Heading>
          <Note>{`Measured on ${reliability.serverTimings.scope} (${reliability.serverTimings.startedAt}).`}</Note>
          <Row header cells={['Timing', 'Count', 'p50', 'p95']} />
          {reliability.serverTimings.timings.map((t: any, i: number) => (
            <Row key={`${t.name}-${i}`} cells={[`${t.name}${Object.keys(t.labels).length ? ` ${JSON.stringify(t.labels)}` : ''}`, String(t.count), t.p50Ms === null ? '—' : `${t.p50Ms} ms`, t.p95Ms === null ? '—' : `${t.p95Ms} ms`]} />
          ))}
          <Heading>{`Provider calls (${reliability.providerAttempts.month})`}</Heading>
          <Row header cells={['Provider', 'Attempts', 'Failed', 'Failure rate']} />
          {reliability.providerAttempts.providers.map((p: any) => <Row key={p.provider} cells={[p.provider, String(p.attempts), String(p.failed), pct(p.failureRate)]} />)}
          <Heading>App tasks</Heading>
          <Note>{definitions.taskFailureRate ?? 'Failed task attempts ÷ started attempts.'}</Note>
          <Row header cells={['Task', 'Accounts', 'Started', 'Failure rate', 'Cancel rate']} />
          {reliability.clientTasks.map((t: any) => <Row key={t.task} cells={[t.task, count(t.accounts), t.started === null ? '—' : String(t.started), pct(t.failureRate), pct(t.cancelRate)]} />)}
          {reliability.notes.map((n: string) => <Note key={n}>{n}</Note>)}
        </View>
      );
    }
    if (!report) return null;
    if (view === 'adoption') {
      return (
        <View testID="admin-analytics-adoption">
          <Note>{`Consenting active accounts: ${count(report.adoption.activeAccounts)}`}</Note>
          <Note>{`Reach: ${definitions.reach} Adoption: ${definitions.meaningfulAdoption} Repeat: ${definitions.repeatUse}`}</Note>
          <Row header cells={['Feature', 'Reached', 'Reach', 'Adopted', 'Adoption', 'Repeat use']} />
          {report.adoption.features.map((f: any) => (
            <Row key={f.feature} cells={[f.feature, count(f.reachAccounts), pct(f.reach), count(f.adoptedAccounts), pct(f.meaningfulAdoption), pct(f.repeatUse)]} />
          ))}
          {!report.adoption.features.length ? <Note>No events in this window.</Note> : null}
        </View>
      );
    }
    if (view === 'platform') {
      const cohorts = report.platform.cohorts;
      return (
        <View testID="admin-analytics-platform">
          <Note>{definitions.platformCohorts}</Note>
          <Row header cells={['Web only', 'Native only', 'Both']} />
          <Row cells={[count(cohorts.webOnly), count(cohorts.nativeOnly), count(cohorts.both)]} />
          <Row header cells={['Platform', 'Accounts', 'Sessions']} />
          {report.platform.platforms.map((p: any) => <Row key={p.platform} cells={[p.platform, count(p.accounts), p.sessions === null ? '—' : String(p.sessions)]} />)}
          <Heading>App versions</Heading>
          {report.platform.appVersions.map((v: any) => <Row key={v.platformVersion} cells={[v.platformVersion, count(v.accounts)]} />)}
        </View>
      );
    }
    const phase = report.tripPhase;
    return (
      <View testID="admin-analytics-trip-phase">
        <Note>{definitions.tripPhase}</Note>
        <Row header cells={['Phase', 'Accounts', 'Events']} />
        {phase.phases.map((p: any) => <Row key={p.phase} cells={[p.phase, count(p.accounts), p.events === null ? '—' : String(p.events)]} />)}
        <Heading>During-trip engagement</Heading>
        <Note>{definitions.duringTripEngagement}</Note>
        <Row header cells={['Traveler–trip pairs', 'Used during trip', 'Rate']} />
        <Row cells={[count(phase.travelerTripPairs), count(phase.duringTripPairs), pct(phase.duringTripEngagement)]} />
        <Note>{`Time zone used: ${Object.entries(phase.timezoneCoverage).map(([k, v]) => `${k} ${pct(v as number)}`).join(', ') || 'no trip events'} (device = unverified proxy).`}</Note>
      </View>
    );
  };

  return (
    <View style={styles.section} testID="admin-analytics-section">
      <Text style={[styles.title, { color: c.text }]}>Analytics</Text>
      <View style={styles.pills}>
        {VIEWS.map((v) => (
          <TouchableOpacity key={v.key} accessibilityRole="button" testID={`admin-analytics-view-${v.key}`}
            onPress={() => setView(v.key)}
            style={[styles.pill, { borderColor: view === v.key ? c.primary : c.border, backgroundColor: view === v.key ? c.primary : 'transparent' }]}>
            <Text style={{ color: view === v.key ? c.onPrimary : c.text }}>{v.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {view !== 'cost' ? (
        <View style={styles.pills}>
          {WINDOWS.map((w) => (
            <TouchableOpacity key={w} accessibilityRole="button" testID={`admin-analytics-window-${w}`}
              onPress={() => setDays(w)}
              style={[styles.pill, { borderColor: days === w ? c.primary : c.border }]}>
              <Text style={{ color: c.text, fontWeight: days === w ? '700' : '400' }}>{`${w} days`}</Text>
            </TouchableOpacity>
          ))}
          {view === 'adoption' || view === 'platform' || view === 'trip_phase' ? (
            <TouchableOpacity accessibilityRole="button" testID="admin-analytics-export" onPress={() => { void exportCsv(); }} style={[styles.pill, { borderColor: c.border }]}>
              <Text style={{ color: c.text }}>Download CSV</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
      {exportMessage ? <Note>{exportMessage}</Note> : null}
      {error ? <Text style={[styles.note, { color: c.error }]}>{error}</Text> : null}
      {loading ? <Note>Loading…</Note> : null}
      {view !== 'cost' && view !== 'reliability' ? <MetaBlock /> : null}
      {renderBody()}
      {meta?.notes && view !== 'cost' ? meta.notes.map((n: string) => <Note key={n}>{n}</Note>) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  section: { gap: 8 },
  title: { fontSize: 20, fontWeight: '700' },
  heading: { fontSize: 15, fontWeight: '700', marginTop: 12 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  meta: { gap: 2, marginVertical: 4 },
  note: { fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 6 },
  cell: { flex: 1, fontSize: 13 },
  firstCell: { flex: 1.6 },
  headerCell: { fontWeight: '600', fontSize: 12 },
});

export default AnalyticsSection;
