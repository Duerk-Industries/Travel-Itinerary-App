import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../../theme/theme';

import { useAppTheme as useStyleTheme } from '../../theme/ThemeContext';
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Share, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';


/**
 * Admin → Analytics (docs/implementation-plans/analytics-upgrade.md Phase 5): five aggregate
 * views over consenting users. Every view shows its definition, population, window and
 * freshness; counts under the minimum cohort arrive from the server as null and render "—".
 */

type Suppressible = { value: number | null; suppressed: boolean };
type View_ = 'adoption' | 'cost' | 'reliability' | 'platform' | 'trip_phase' | 'rollout';
const WINDOWS = [7, 30, 90] as const;
const VIEWS: Array<{ key: View_; label: string }> = [
  { key: 'adoption', label: 'Feature adoption' },
  { key: 'cost', label: 'Cost' },
  { key: 'reliability', label: 'Reliability' },
  { key: 'platform', label: 'Platform mix' },
  { key: 'trip_phase', label: 'Trip phase' },
  { key: 'rollout', label: 'Rollout' },
];

const fetchAdmin = async (backendUrl: string, headers: Record<string, string>, path: string) => {
  const res = await fetch(`${backendUrl}/api/admin${path}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string })?.error ?? `HTTP ${res.status}`);
  }
  return res;
};

type RolloutMode = 'off' | 'internal' | 'percentage' | 'all';
type PurposeRollout = { flagEnabled: boolean; mode: RolloutMode; percent: number; excludeEurope: boolean };
const PURPOSES: Array<{ key: 'product_analytics' | 'optional_diagnostics'; label: string; flag: string }> = [
  { key: 'product_analytics', label: 'Product analytics', flag: 'analytics_collection_enabled' },
  { key: 'optional_diagnostics', label: 'Detailed diagnostics', flag: 'diagnostics_user_linked_enabled' },
];

/** Canary rollout editor (Phase 6). The feature flags remain the kill switches. */
const RolloutPanel: React.FC<{ backendUrl: string; headers: Record<string, string>; theme: AppTheme }> = ({ backendUrl, headers, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const c = theme.colors;
  const [rollout, setRollout] = useState<Record<string, PurposeRollout> | null>(null);
  const [drafts, setDrafts] = useState<Record<string, PurposeRollout & { reason: string }>>({});
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    const data = await (await fetchAdmin(backendUrl, headers, '/analytics/rollout')).json();
    setRollout(data);
    setDrafts(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { ...(v as PurposeRollout), reason: '' }])));
  }, [backendUrl, headers]);
  useEffect(() => { load().catch((e) => setMessage((e as Error).message)); }, [load]);
  const save = async (purpose: string) => {
    const draft = drafts[purpose];
    if (!draft || draft.reason.trim().length < 3) return; // the server also requires a reason
    setMessage(null);
    try {
      const res = await fetch(`${backendUrl}/api/admin/analytics/rollout/${purpose}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: draft.mode, percent: draft.percent, excludeEurope: draft.excludeEurope, reason: draft.reason }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      setMessage('Saved. Takes effect within a minute; recorded in the audit log.');
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  if (!rollout) return message ? <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_AnalyticsSection_1', { c: c }, (theme ?? _styleTheme))]}>{message}</Text> : null;
  return (
    <View testID="admin-analytics-rollout" style={themeStyle('components_admin_AnalyticsSection_2', {  }, (theme ?? _styleTheme))}>
      <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_AnalyticsSection_3', { c: c }, (theme ?? _styleTheme))]}>
        Who is offered each optional purpose while its feature flag is on. Internal means admins and internal canary accounts.
        Excluding Europe keeps collection off for devices in European (or unknown) time zones until counsel signs off.
        Turning a flag off in Feature Flags stops everything immediately.
      </Text>
      {PURPOSES.map((p) => {
        const draft = drafts[p.key];
        if (!draft) return null;
        const update = (patch: Partial<PurposeRollout & { reason: string }>) =>
          setDrafts((d) => ({ ...d, [p.key]: { ...d[p.key], ...patch } }));
        const canSave = draft.reason.trim().length >= 3;
        return (
          <View key={p.key} style={[styles((theme ?? _styleTheme)).card, themeStyle('components_admin_AnalyticsSection_4', { c: c }, (theme ?? _styleTheme))]}>
            <Text style={[styles((theme ?? _styleTheme)).heading, themeStyle('components_admin_AnalyticsSection_5', { c: c }, (theme ?? _styleTheme))]}>{p.label}</Text>
            <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_AnalyticsSection_6', { rollout: rollout, p: p, c: c }, (theme ?? _styleTheme))]}>
              {`Kill switch ${p.flag}: ${rollout[p.key].flagEnabled ? 'on' : 'OFF (nothing is collected)'}`}
            </Text>
            <View style={styles((theme ?? _styleTheme)).pills}>
              {(['off', 'internal', 'percentage', 'all'] as RolloutMode[]).map((mode) => (
                <TouchableOpacity key={mode} accessibilityRole="button" testID={`admin-rollout-${p.key}-${mode}`} onPress={() => update({ mode })}
                  style={[styles((theme ?? _styleTheme)).pill, themeStyle('components_admin_AnalyticsSection_7', { draft: draft, mode: mode, c: c }, (theme ?? _styleTheme))]}>
                  <Text style={themeStyle('components_admin_AnalyticsSection_8', { draft: draft, mode: mode, c: c }, (theme ?? _styleTheme))}>{mode}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {draft.mode === 'percentage' ? (
              <TextInput accessibilityLabel={`${p.label} percentage`} keyboardType="number-pad" value={String(draft.percent)}
                onChangeText={(t) => update({ percent: Math.max(0, Math.min(100, Number(t.replace(/[^0-9]/g, '')) || 0)) })}
                style={[styles((theme ?? _styleTheme)).input, themeStyle('components_admin_AnalyticsSection_9', { c: c }, (theme ?? _styleTheme))]} />
            ) : null}
            <View style={[styles((theme ?? _styleTheme)).row, themeStyle('components_admin_AnalyticsSection_10', {  }, (theme ?? _styleTheme))]}>
              <Text style={[styles((theme ?? _styleTheme)).cell, themeStyle('components_admin_AnalyticsSection_11', { c: c }, (theme ?? _styleTheme))]}>Exclude Europe</Text>
              <Switch accessibilityLabel={`${p.label} exclude Europe`} value={draft.excludeEurope} onValueChange={(v) => update({ excludeEurope: v })} />
            </View>
            <TextInput accessibilityLabel={`${p.label} reason`} placeholder="Reason (required, audited)" value={draft.reason}
              onChangeText={(t) => update({ reason: t })} style={[styles((theme ?? _styleTheme)).input, themeStyle('components_admin_AnalyticsSection_12', { c: c }, (theme ?? _styleTheme))]} />
            <TouchableOpacity accessibilityRole="button" testID={`admin-rollout-${p.key}-save`} onPress={() => { void save(p.key); }}
              disabled={!canSave} style={[styles((theme ?? _styleTheme)).pill, themeStyle('components_admin_AnalyticsSection_13', { c: c, canSave: canSave }, (theme ?? _styleTheme))]}>
              <Text style={themeStyle('components_admin_AnalyticsSection_14', { c: c }, (theme ?? _styleTheme))}>Save</Text>
            </TouchableOpacity>
          </View>
        );
      })}
      {message ? <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_AnalyticsSection_15', { c: c }, (theme ?? _styleTheme))]}>{message}</Text> : null}
    </View>
  );
};

const count = (s: Suppressible | undefined | null): string => (!s || s.value === null ? '—' : String(s.value));
const pct = (x: number | null | undefined): string => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`);
const usd = (micros: number | null | undefined): string => (micros === null || micros === undefined ? '—' : `$${(micros / 1_000_000).toFixed(2)}`);

export const AnalyticsSection: React.FC<{ backendUrl: string; headers: Record<string, string>; theme: AppTheme }> = ({
  backendUrl,
  headers,
  theme: _providedTheme,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
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
      if (view === 'rollout') {
        // RolloutPanel loads its own data.
      } else if (view === 'cost') {
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
    <View style={[styles((theme ?? _styleTheme)).row, themeStyle('components_admin_AnalyticsSection_16', { c: c }, (theme ?? _styleTheme))]}>
      {cells.map((cell, i) => (
        <Text key={i} style={[styles((theme ?? _styleTheme)).cell, i === 0 && styles((theme ?? _styleTheme)).firstCell, themeStyle('components_admin_AnalyticsSection_17', { header: header, c: c }, (theme ?? _styleTheme)), header && styles((theme ?? _styleTheme)).headerCell]}>{cell}</Text>
      ))}
    </View>
  );
  const Note = ({ children }: { children: React.ReactNode }) => <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_AnalyticsSection_18', { c: c }, (theme ?? _styleTheme))]}>{children}</Text>;
  const Heading = ({ children }: { children: React.ReactNode }) => <Text style={[styles((theme ?? _styleTheme)).heading, themeStyle('components_admin_AnalyticsSection_19', { c: c }, (theme ?? _styleTheme))]}>{children}</Text>;

  const meta = report?.meta;
  const definitions = meta?.definitions ?? {};
  const MetaBlock = () => meta ? (
    <View style={styles((theme ?? _styleTheme)).meta} testID="admin-analytics-meta">
      <Note>{definitions.population}</Note>
      <Note>{`Window: last ${meta.windowDays} days (UTC) · ${meta.eventsScanned} events · freshest event ${meta.latestReceivedAt ?? 'none'} · metrics ${meta.metricVersion}`}</Note>
      <Note>{`Counts under ${meta.minCohort} accounts are hidden (—).`}</Note>
      {meta.truncated ? <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_AnalyticsSection_20', { c: c }, (theme ?? _styleTheme))]}>Truncated: more events than one report reads. Move to daily rollups.</Text> : null}
    </View>
  ) : null;

  const renderBody = () => {
    if (view === 'rollout') return <RolloutPanel backendUrl={backendUrl} headers={headers} theme={theme} />;
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
            <Row key={f.feature} cells={f.available === false
              ? [`${f.feature} (flag off)`, count(f.reachAccounts), 'n/a', count(f.adoptedAccounts), 'n/a', 'n/a']
              : [f.feature, count(f.reachAccounts), pct(f.reach), count(f.adoptedAccounts), pct(f.meaningfulAdoption), pct(f.repeatUse)]} />
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
    <View style={styles((theme ?? _styleTheme)).section} testID="admin-analytics-section">
      <Text style={[styles((theme ?? _styleTheme)).title, themeStyle('components_admin_AnalyticsSection_21', { c: c }, (theme ?? _styleTheme))]}>Analytics</Text>
      <View style={styles((theme ?? _styleTheme)).pills}>
        {VIEWS.map((v) => (
          <TouchableOpacity key={v.key} accessibilityRole="button" testID={`admin-analytics-view-${v.key}`}
            onPress={() => setView(v.key)}
            style={[styles((theme ?? _styleTheme)).pill, themeStyle('components_admin_AnalyticsSection_22', { view: view, v: v, c: c }, (theme ?? _styleTheme))]}>
            <Text style={themeStyle('components_admin_AnalyticsSection_23', { view: view, v: v, c: c }, (theme ?? _styleTheme))}>{v.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {view !== 'cost' && view !== 'rollout' ? (
        <View style={styles((theme ?? _styleTheme)).pills}>
          {WINDOWS.map((w) => (
            <TouchableOpacity key={w} accessibilityRole="button" testID={`admin-analytics-window-${w}`}
              onPress={() => setDays(w)}
              style={[styles((theme ?? _styleTheme)).pill, themeStyle('components_admin_AnalyticsSection_24', { days: days, w: w, c: c }, (theme ?? _styleTheme))]}>
              <Text style={themeStyle('components_admin_AnalyticsSection_25', { c: c, days: days, w: w }, (theme ?? _styleTheme))}>{`${w} days`}</Text>
            </TouchableOpacity>
          ))}
          {view === 'adoption' || view === 'platform' || view === 'trip_phase' ? (
            <TouchableOpacity accessibilityRole="button" testID="admin-analytics-export" onPress={() => { void exportCsv(); }} style={[styles((theme ?? _styleTheme)).pill, themeStyle('components_admin_AnalyticsSection_26', { c: c }, (theme ?? _styleTheme))]}>
              <Text style={themeStyle('components_admin_AnalyticsSection_27', { c: c }, (theme ?? _styleTheme))}>Download CSV</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
      {exportMessage ? <Note>{exportMessage}</Note> : null}
      {error ? <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_AnalyticsSection_28', { c: c }, (theme ?? _styleTheme))]}>{error}</Text> : null}
      {loading ? <Note>Loading…</Note> : null}
      {view !== 'cost' && view !== 'reliability' && view !== 'rollout' ? <MetaBlock /> : null}
      {renderBody()}
      {meta?.notes && view !== 'cost' && view !== 'rollout' ? meta.notes.map((n: string) => <Note key={n}>{n}</Note>) : null}
    </View>
  );
};

const styles = (_theme: import('../../theme/theme').AppTheme) => themeStyle('components_admin_AnalyticsSection_29', { StyleSheet: StyleSheet }, _theme);

export default AnalyticsSection;
