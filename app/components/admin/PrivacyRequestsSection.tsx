import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../../theme/theme';

import { useAppTheme as useStyleTheme } from '../../theme/ThemeContext';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import DateField from '../DateField';

/**
 * Admin → Privacy requests (docs/analytics-runbook.md "Privacy rights requests"): the register
 * of rights requests received outside the app (email, web form), with statutory due dates and
 * overdue flags, plus the self-service erasure jobs. Every change needs a reason and is
 * written to the audit log by the server.
 *
 * The register never holds the requester's email or name: identity stays in the support
 * mailbox, and a known account is stored only as its pseudonymous subject hash.
 */

type RequestType = 'access' | 'rectification' | 'erasure' | 'restriction' | 'objection' | 'portability' | 'opt_out' | 'appeal';
type Jurisdiction = 'GDPR' | 'UK_GDPR' | 'CCPA' | 'US_STATE' | 'OTHER';
type Channel = 'email' | 'web' | 'in_app' | 'other';
type RequestStatus = 'open' | 'verifying' | 'in_progress' | 'completed' | 'rejected';

export type RightsRequest = {
  id: string;
  requestType: RequestType;
  jurisdiction: Jurisdiction;
  channel: Channel;
  status: RequestStatus;
  receivedAt: string;
  dueAt: string;
  extended: boolean;
  subjectHash: string | null;
  notes: string | null;
  closedAt: string | null;
  overdue: boolean;
};

type ErasureJob = {
  id: string;
  scope: 'analytics' | 'account';
  status: 'pending' | 'completed' | 'failed';
  steps: Record<string, { status: 'pending' | 'done' | 'failed' | 'not_applicable'; affected?: number | null; error?: string }>;
  attempts: number;
  lastError: string | null;
  requestedBy: 'user' | 'admin' | 'system';
  requestedAt: string;
  dueAt: string;
  completedAt: string | null;
};

const REQUEST_TYPES: RequestType[] = ['access', 'rectification', 'erasure', 'restriction', 'objection', 'portability', 'opt_out', 'appeal'];
const JURISDICTIONS: Jurisdiction[] = ['GDPR', 'UK_GDPR', 'CCPA', 'US_STATE', 'OTHER'];
const CHANNELS: Channel[] = ['email', 'web', 'in_app', 'other'];
const STATUSES: RequestStatus[] = ['open', 'verifying', 'in_progress', 'completed', 'rejected'];
const CLOSED: RequestStatus[] = ['completed', 'rejected'];
const JOB_FILTERS = ['all', 'pending', 'failed', 'completed'] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const dateOnly = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '—');
const label = (value: string) => value.replace(/_/g, ' ');

/** "due in 5 days", "due today", "3 days overdue", or the close date. */
export const dueLabel = (request: Pick<RightsRequest, 'dueAt' | 'status' | 'closedAt'>, now = Date.now()): string => {
  if (CLOSED.includes(request.status)) return `closed ${dateOnly(request.closedAt)}`;
  const days = Math.ceil((new Date(request.dueAt).getTime() - now) / DAY_MS);
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`;
  if (days === 0) return 'due today';
  return `due in ${days} day${days === 1 ? '' : 's'}`;
};

const errorFrom = async (res: Response) =>
  ((await res.json().catch(() => ({}))) as { error?: string })?.error ?? `HTTP ${res.status}`;

const Pills = <T extends string>({ options, value, onChange, testIDPrefix, theme: _providedTheme }: {
  options: readonly T[]; value: T; onChange: (v: T) => void; testIDPrefix: string; theme: AppTheme;
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const c = theme.colors;
  return (
    <View style={styles((theme ?? _styleTheme)).pills}>
      {options.map((option) => (
        <TouchableOpacity key={option} accessibilityRole="button" accessibilityState={{ selected: value === option }}
          testID={`${testIDPrefix}-${option}`} onPress={() => onChange(option)}
          style={[styles((theme ?? _styleTheme)).pill, themeStyle('components_admin_PrivacyRequestsSection_1', { value: value, option: option, c: c }, (theme ?? _styleTheme))]}>
          <Text style={themeStyle('components_admin_PrivacyRequestsSection_2', { value: value, option: option, c: c }, (theme ?? _styleTheme))}>{label(option)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const NewRequestForm: React.FC<{ onSubmit: (body: Record<string, unknown>) => Promise<string | null>; theme: AppTheme }> = ({ onSubmit, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const c = theme.colors;
  const [requestType, setRequestType] = useState<RequestType>('access');
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>('GDPR');
  const [channel, setChannel] = useState<Channel>('email');
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [accountUserId, setAccountUserId] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(receivedAt) && !Number.isNaN(Date.parse(receivedAt));
  const dateFieldStyles = { input: [styles((theme ?? _styleTheme)).input, themeStyle('components_admin_PrivacyRequestsSection_3', { validDate: validDate, c: c }, (theme ?? _styleTheme))], cellText: themeStyle('components_admin_PrivacyRequestsSection_4', { c: c }, (theme ?? _styleTheme)) };
  const canSave = reason.trim().length >= 3 && validDate;
  const submit = async () => {
    if (!canSave) return;
    const error = await onSubmit({
      requestType, jurisdiction, channel, receivedAt, reason: reason.trim(),
      ...(accountUserId.trim() ? { accountUserId: accountUserId.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
    setMessage(error ?? 'Recorded. The due date follows the jurisdiction (GDPR/UK: 1 month; CCPA/US states: 45 days; other: 30 days).');
    if (!error) { setAccountUserId(''); setNotes(''); setReason(''); }
  };
  return (
    <View testID="admin-privacy-new-request" style={[styles((theme ?? _styleTheme)).card, themeStyle('components_admin_PrivacyRequestsSection_5', { c: c }, (theme ?? _styleTheme))]}>
      <Text style={[styles((theme ?? _styleTheme)).heading, themeStyle('components_admin_PrivacyRequestsSection_6', { c: c }, (theme ?? _styleTheme))]}>Record a request</Text>
      <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_PrivacyRequestsSection_7', { c: c }, (theme ?? _styleTheme))]}>
        For requests received by email or another channel. Do not enter the requester's email or name here; keep identity in the
        support mailbox. If they have an account, paste its user ID and only a pseudonymous hash is stored.
      </Text>
      <Text style={[styles((theme ?? _styleTheme)).label, themeStyle('components_admin_PrivacyRequestsSection_8', { c: c }, (theme ?? _styleTheme))]}>Type</Text>
      <Pills options={REQUEST_TYPES} value={requestType} onChange={setRequestType} testIDPrefix="admin-privacy-new-type" theme={theme} />
      <Text style={[styles((theme ?? _styleTheme)).label, themeStyle('components_admin_PrivacyRequestsSection_9', { c: c }, (theme ?? _styleTheme))]}>Jurisdiction</Text>
      <Pills options={JURISDICTIONS} value={jurisdiction} onChange={setJurisdiction} testIDPrefix="admin-privacy-new-jurisdiction" theme={theme} />
      <Text style={[styles((theme ?? _styleTheme)).label, themeStyle('components_admin_PrivacyRequestsSection_10', { c: c }, (theme ?? _styleTheme))]}>Channel</Text>
      <Pills options={CHANNELS} value={channel} onChange={setChannel} testIDPrefix="admin-privacy-new-channel" theme={theme} />
      <DateField
        value={receivedAt}
        onChange={setReceivedAt}
        styles={dateFieldStyles}
        theme={theme}
        accessibilityLabel="Date received (YYYY-MM-DD)"
        placeholder="Date received (YYYY-MM-DD)"
        testID="admin-privacy-new-received"
      />
      <TextInput accessibilityLabel="Account user ID (optional)" placeholder="Account user ID (optional)" value={accountUserId}
        onChangeText={setAccountUserId} autoCapitalize="none" style={[styles((theme ?? _styleTheme)).input, themeStyle('components_admin_PrivacyRequestsSection_11', { c: c }, (theme ?? _styleTheme))]} />
      <TextInput accessibilityLabel="Notes (optional)" placeholder="Notes: actions taken, no personal details" value={notes}
        onChangeText={setNotes} multiline style={[styles((theme ?? _styleTheme)).input, themeStyle('components_admin_PrivacyRequestsSection_12', { c: c }, (theme ?? _styleTheme))]} />
      <TextInput accessibilityLabel="New request reason" placeholder="Reason (required, audited)" value={reason}
        onChangeText={setReason} style={[styles((theme ?? _styleTheme)).input, themeStyle('components_admin_PrivacyRequestsSection_13', { c: c }, (theme ?? _styleTheme))]} />
      <TouchableOpacity accessibilityRole="button" testID="admin-privacy-new-save" disabled={!canSave} onPress={() => { void submit(); }}
        style={[styles((theme ?? _styleTheme)).pill, themeStyle('components_admin_PrivacyRequestsSection_14', { c: c, canSave: canSave }, (theme ?? _styleTheme))]}>
        <Text style={themeStyle('components_admin_PrivacyRequestsSection_15', { c: c }, (theme ?? _styleTheme))}>Record request</Text>
      </TouchableOpacity>
      {message ? <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_PrivacyRequestsSection_16', { c: c }, (theme ?? _styleTheme))]}>{message}</Text> : null}
    </View>
  );
};

const RequestEditor: React.FC<{
  request: RightsRequest;
  onSave: (id: string, body: Record<string, unknown>) => Promise<string | null>;
  theme: AppTheme;
}> = ({ request, onSave, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const c = theme.colors;
  const [status, setStatus] = useState<RequestStatus>(request.status);
  const [extend, setExtend] = useState(false);
  const [notes, setNotes] = useState(request.notes ?? '');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const changed = status !== request.status || extend || notes !== (request.notes ?? '');
  const canSave = changed && reason.trim().length >= 3;
  const save = async () => {
    if (!canSave) return;
    const error = await onSave(request.id, {
      reason: reason.trim(),
      ...(status !== request.status ? { status } : {}),
      ...(extend ? { extend: true } : {}),
      ...(notes !== (request.notes ?? '') ? { notes } : {}),
    });
    setMessage(error);
  };
  return (
    <View style={themeStyle('components_admin_PrivacyRequestsSection_17', {  }, (theme ?? _styleTheme))}>
      <Pills options={STATUSES} value={status} onChange={setStatus} testIDPrefix={`admin-privacy-status-${request.id}`} theme={theme} />
      {!request.extended && !CLOSED.includes(request.status) ? (
        <View style={[styles((theme ?? _styleTheme)).inline, themeStyle('components_admin_PrivacyRequestsSection_18', {  }, (theme ?? _styleTheme))]}>
          <Switch accessibilityLabel="Apply the statutory extension" value={extend} onValueChange={setExtend} />
          <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_PrivacyRequestsSection_19', { c: c }, (theme ?? _styleTheme))]}>
            Apply the one-time statutory extension (GDPR/UK: +2 months; CCPA/US states: +45 days; other: +30 days). Tell the requester why, before the original due date.
          </Text>
        </View>
      ) : null}
      <TextInput accessibilityLabel="Request notes" placeholder="Notes: actions taken, no personal details" value={notes}
        onChangeText={setNotes} multiline style={[styles((theme ?? _styleTheme)).input, themeStyle('components_admin_PrivacyRequestsSection_20', { c: c }, (theme ?? _styleTheme))]} />
      <TextInput accessibilityLabel="Update reason" placeholder="Reason (required, audited)" value={reason}
        onChangeText={setReason} style={[styles((theme ?? _styleTheme)).input, themeStyle('components_admin_PrivacyRequestsSection_21', { c: c }, (theme ?? _styleTheme))]} />
      <TouchableOpacity accessibilityRole="button" testID={`admin-privacy-save-${request.id}`} disabled={!canSave} onPress={() => { void save(); }}
        style={[styles((theme ?? _styleTheme)).pill, themeStyle('components_admin_PrivacyRequestsSection_22', { c: c, canSave: canSave }, (theme ?? _styleTheme))]}>
        <Text style={themeStyle('components_admin_PrivacyRequestsSection_23', { c: c }, (theme ?? _styleTheme))}>Save</Text>
      </TouchableOpacity>
      {message ? <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_PrivacyRequestsSection_24', { c: c }, (theme ?? _styleTheme))]}>{message}</Text> : null}
    </View>
  );
};

const RequestsPanel: React.FC<{ backendUrl: string; headers: Record<string, string>; theme: AppTheme }> = ({ backendUrl, headers, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const c = theme.colors;
  const [filter, setFilter] = useState<'active' | 'all' | RequestStatus>('active');
  const [requests, setRequests] = useState<RightsRequest[] | null>(null);
  const [overdueCount, setOverdueCount] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const query = filter === 'active' || filter === 'all' ? '' : `?status=${filter}`;
      const res = await fetch(`${backendUrl}/api/admin/privacy/rights-requests${query}`, { headers });
      if (!res.ok) throw new Error(await errorFrom(res));
      const data = (await res.json()) as { requests: RightsRequest[]; overdueCount: number };
      const list = filter === 'active' ? data.requests.filter((r) => !CLOSED.includes(r.status)) : data.requests;
      // Overdue first, then the nearest due date.
      list.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.dueAt.localeCompare(b.dueAt));
      setRequests(list);
      setOverdueCount(data.overdueCount);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [backendUrl, headers, filter]);
  useEffect(() => { void load(); }, [load]);

  const send = async (method: 'POST' | 'PATCH', path: string, body: Record<string, unknown>): Promise<string | null> => {
    try {
      const res = await fetch(`${backendUrl}/api/admin/privacy/rights-requests${path}`, {
        method,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return await errorFrom(res);
      await load();
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  return (
    <View testID="admin-privacy-requests" style={themeStyle('components_admin_PrivacyRequestsSection_25', {  }, (theme ?? _styleTheme))}>
      {overdueCount > 0 ? (
        <Text testID="admin-privacy-overdue" style={[styles((theme ?? _styleTheme)).banner, themeStyle('components_admin_PrivacyRequestsSection_26', { c: c }, (theme ?? _styleTheme))]}>
          {`${overdueCount} request${overdueCount === 1 ? ' is' : 's are'} past the statutory due date.`}
        </Text>
      ) : null}
      <View style={[styles((theme ?? _styleTheme)).inline, themeStyle('components_admin_PrivacyRequestsSection_27', {  }, (theme ?? _styleTheme))]}>
        <Pills options={['active', 'all', ...STATUSES] as const} value={filter} onChange={setFilter} testIDPrefix="admin-privacy-filter" theme={theme} />
        <TouchableOpacity accessibilityRole="button" testID="admin-privacy-new-toggle" onPress={() => setShowForm((v) => !v)}
          style={[styles((theme ?? _styleTheme)).pill, themeStyle('components_admin_PrivacyRequestsSection_28', { c: c }, (theme ?? _styleTheme))]}>
          <Text style={themeStyle('components_admin_PrivacyRequestsSection_29', { c: c }, (theme ?? _styleTheme))}>{showForm ? 'Close form' : 'Record request'}</Text>
        </TouchableOpacity>
      </View>
      {showForm ? <NewRequestForm theme={theme} onSubmit={(body) => send('POST', '', body)} /> : null}
      {error ? <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_PrivacyRequestsSection_30', { c: c }, (theme ?? _styleTheme))]}>{error}</Text> : null}
      {requests && !requests.length ? <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_PrivacyRequestsSection_31', { c: c }, (theme ?? _styleTheme))]}>No requests in this view.</Text> : null}
      {(requests ?? []).map((r) => (
        <View key={r.id} testID={`admin-privacy-request-${r.id}`} style={[styles((theme ?? _styleTheme)).card, themeStyle('components_admin_PrivacyRequestsSection_32', { r: r, c: c }, (theme ?? _styleTheme))]}>
          <TouchableOpacity accessibilityRole="button" onPress={() => setExpanded((cur) => (cur === r.id ? null : r.id))}>
            <Text style={[styles((theme ?? _styleTheme)).heading, themeStyle('components_admin_PrivacyRequestsSection_33', { c: c }, (theme ?? _styleTheme))]}>
              {`${label(r.requestType)} · ${label(r.jurisdiction)} · ${label(r.status)}`}
            </Text>
            <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_PrivacyRequestsSection_34', { r: r, c: c }, (theme ?? _styleTheme))]}>
              {`Received ${dateOnly(r.receivedAt)} by ${label(r.channel)} · due ${dateOnly(r.dueAt)}${r.extended ? ' (extended)' : ''} · ${dueLabel(r)}`}
            </Text>
            <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_PrivacyRequestsSection_35', { c: c }, (theme ?? _styleTheme))]}>
              {r.subjectHash ? `Account subject ${r.subjectHash.slice(0, 12)}…` : 'No linked account'}
              {r.notes ? ` · ${r.notes}` : ''}
            </Text>
          </TouchableOpacity>
          {expanded === r.id ? <RequestEditor request={r} theme={theme} onSave={(id, body) => send('PATCH', `/${encodeURIComponent(id)}`, body)} /> : null}
        </View>
      ))}
    </View>
  );
};

const ErasureJobsPanel: React.FC<{ backendUrl: string; headers: Record<string, string>; theme: AppTheme }> = ({ backendUrl, headers, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const c = theme.colors;
  const [filter, setFilter] = useState<(typeof JOB_FILTERS)[number]>('all');
  const [jobs, setJobs] = useState<ErasureJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const query = filter === 'all' ? '' : `?status=${filter}`;
        const res = await fetch(`${backendUrl}/api/admin/privacy/erasure-jobs${query}`, { headers });
        if (!res.ok) throw new Error(await errorFrom(res));
        const data = (await res.json()) as { jobs: ErasureJob[] };
        if (!cancelled) setJobs(data.jobs);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [backendUrl, headers, filter]);
  return (
    <View testID="admin-privacy-erasure-jobs" style={themeStyle('components_admin_PrivacyRequestsSection_36', {  }, (theme ?? _styleTheme))}>
      <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_PrivacyRequestsSection_37', { c: c }, (theme ?? _styleTheme))]}>
        Deletion and analytics-erasure jobs started by users (or admins). Pending jobs retry automatically; a failed step needs an engineer
        (see the runbook). Raw user IDs are never shown.
      </Text>
      <Pills options={JOB_FILTERS} value={filter} onChange={setFilter} testIDPrefix="admin-erasure-filter" theme={theme} />
      {error ? <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_PrivacyRequestsSection_38', { c: c }, (theme ?? _styleTheme))]}>{error}</Text> : null}
      {jobs && !jobs.length ? <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_PrivacyRequestsSection_39', { c: c }, (theme ?? _styleTheme))]}>No erasure jobs in this view.</Text> : null}
      {(jobs ?? []).map((job) => {
        const steps = Object.entries(job.steps ?? {});
        const failed = steps.filter(([, s]) => s.status === 'failed');
        const overdue = job.status !== 'completed' && new Date(job.dueAt).getTime() < Date.now();
        return (
          <View key={job.id} testID={`admin-erasure-job-${job.id}`} style={[styles((theme ?? _styleTheme)).card, themeStyle('components_admin_PrivacyRequestsSection_40', { job: job, overdue: overdue, c: c }, (theme ?? _styleTheme))]}>
            <Text style={[styles((theme ?? _styleTheme)).heading, themeStyle('components_admin_PrivacyRequestsSection_41', { c: c }, (theme ?? _styleTheme))]}>{`${job.scope} erasure · ${job.status}${overdue ? ' · OVERDUE' : ''}`}</Text>
            <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_PrivacyRequestsSection_42', { c: c }, (theme ?? _styleTheme))]}>
              {`Requested ${dateOnly(job.requestedAt)} by ${job.requestedBy} · due ${dateOnly(job.dueAt)} · ${job.attempts} attempt${job.attempts === 1 ? '' : 's'}${job.completedAt ? ` · completed ${dateOnly(job.completedAt)}` : ''}`}
            </Text>
            <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_PrivacyRequestsSection_43', { c: c }, (theme ?? _styleTheme))]}>
              {`${steps.filter(([, s]) => s.status === 'done' || s.status === 'not_applicable').length}/${steps.length} steps done`}
            </Text>
            {failed.map(([name, s]) => (
              <Text key={name} style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_PrivacyRequestsSection_44', { c: c }, (theme ?? _styleTheme))]}>{`${name}: ${s.error ?? 'failed'}`}</Text>
            ))}
            {job.lastError && !failed.length ? <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_PrivacyRequestsSection_45', { c: c }, (theme ?? _styleTheme))]}>{job.lastError}</Text> : null}
          </View>
        );
      })}
    </View>
  );
};

export const PrivacyRequestsSection: React.FC<{ backendUrl: string; headers: Record<string, string>; theme: AppTheme }> = ({ backendUrl, headers, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const c = theme.colors;
  const [tab, setTab] = useState<'requests' | 'erasure'>('requests');
  return (
    <View testID="admin-privacy-section" style={styles((theme ?? _styleTheme)).section}>
      <Text style={[styles((theme ?? _styleTheme)).title, themeStyle('components_admin_PrivacyRequestsSection_46', { c: c }, (theme ?? _styleTheme))]}>Privacy requests</Text>
      <Text style={[styles((theme ?? _styleTheme)).note, themeStyle('components_admin_PrivacyRequestsSection_47', { c: c }, (theme ?? _styleTheme))]}>
        Rights requests have statutory deadlines: GDPR and UK GDPR one month (extendable once by two months); CCPA and other US state
        laws 45 days (extendable once by 45); anything else is tracked at 30 days (+30). Every change is recorded in the audit log.
      </Text>
      <Pills options={['requests', 'erasure'] as const} value={tab} onChange={setTab} testIDPrefix="admin-privacy-tab" theme={theme} />
      {tab === 'requests'
        ? <RequestsPanel backendUrl={backendUrl} headers={headers} theme={theme} />
        : <ErasureJobsPanel backendUrl={backendUrl} headers={headers} theme={theme} />}
    </View>
  );
};

const styles = (_theme: import('../../theme/theme').AppTheme) => themeStyle('components_admin_PrivacyRequestsSection_48', { StyleSheet: StyleSheet }, _theme);

export default PrivacyRequestsSection;
