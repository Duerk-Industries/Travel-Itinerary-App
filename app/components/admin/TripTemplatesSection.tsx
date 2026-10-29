import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../../theme/theme';

import { useAppTheme as useStyleTheme } from '../../theme/ThemeContext';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { pickTextFile, shareTextFile } from '../../utils/dataTransferPlatform';

/**
 * Admin → Itinerary templates. Sample itineraries are written outside the app by an LLM that follows the
 * downloadable instructions, saved as one JSON "bundle", checked here, and then imported so travelers see
 * them without a deploy. The same screen downloads what is live (to edit and re-import), and removes an
 * import. The server does the checking (services/tripTemplateBundle.ts); this screen shows what it says.
 */

type TemplateSource = 'bundled' | 'imported' | 'imported-override';
type AdminTemplate = {
  id: string; title: string; days: number; route: string; countries: string[]; source: TemplateSource; enabled: boolean; activityCount: number;
};
type ImportStatus = 'new' | 'updated' | 'unchanged' | 'invalid';
type MediaCounts = { added: number; updated: number; unchanged: number; rejected: Array<{ key: string; error: string }> };
type ImportReport = {
  ok: boolean;
  fatal?: string[];
  applied: boolean;
  templates: Array<{ id: string; title: string; status: ImportStatus; source?: TemplateSource; errors: string[]; warnings: string[] }>;
  media: { places: MediaCounts; destinations: MediaCounts };
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SOURCE_LABEL: Record<TemplateSource, string> = { bundled: 'Built in', imported: 'Imported', 'imported-override': 'Imported (replaces built-in)' };
const STATUS_LABEL: Record<ImportStatus, string> = { new: 'New', updated: 'Updated', unchanged: 'Unchanged', invalid: 'Needs fixes' };

const errorFrom = async (res: Response): Promise<string> =>
  ((await res.json().catch(() => ({}))) as { error?: string })?.error ?? `HTTP ${res.status}`;

const countLine = (report: ImportReport): string => {
  const count = (status: ImportStatus) => report.templates.filter((template) => template.status === status).length;
  const media = (kind: 'places' | 'destinations') => report.media[kind].added + report.media[kind].updated;
  return [
    `${count('new')} new`, `${count('updated')} updated`, `${count('unchanged')} unchanged`,
    ...(count('invalid') ? [`${count('invalid')} need fixes`] : []),
    `${media('places')} place and ${media('destinations')} destination descriptions added or changed`,
  ].join(' · ');
};

type Props = { backendUrl: string; headers: Record<string, string>; theme?: AppTheme };

export const TripTemplatesSection: React.FC<Props> = ({ backendUrl, headers, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const s = themeStyle('components_admin_TripTemplatesSection_1', { StyleSheet }, theme) as ReturnType<typeof StyleSheet.create> & Record<string, any>;
  const base = `${backendUrl}/api/admin/trip-templates`;

  const [templates, setTemplates] = useState<AdminTemplate[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [checkedText, setCheckedText] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const canImport = Boolean(report?.ok && !report.applied && checkedText === text && !busy);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch(base, { headers });
      if (!res.ok) throw new Error(await errorFrom(res));
      setTemplates(((await res.json()) as { templates: AdminTemplate[] }).templates ?? []);
      setListError(null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Unable to load templates.');
    }
  }, [base, headers]);

  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  const download = async (path: string, filename: string, mimeType: string) => {
    setMessage(null);
    try {
      const res = await fetch(`${base}${path}`, { headers });
      if (!res.ok) throw new Error(await errorFrom(res));
      await shareTextFile(filename, await res.text(), { mimeType });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'The download failed.');
    }
  };
  const stamp = new Date().toISOString().slice(0, 10);

  const send = async (bundleText: string, dryRun: boolean): Promise<ImportReport | null> => {
    let bundle: unknown;
    try {
      bundle = JSON.parse(bundleText);
    } catch (err) {
      setReport({ ok: false, applied: false, fatal: [`This is not valid JSON: ${err instanceof Error ? err.message : 'it could not be read'}. Ask the LLM to return the file again as plain JSON.`], templates: [], media: { places: { added: 0, updated: 0, unchanged: 0, rejected: [] }, destinations: { added: 0, updated: 0, unchanged: 0, rejected: [] } } });
      setCheckedText(bundleText);
      return null;
    }
    const res = await fetch(`${base}/import`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ bundle, dryRun }) });
    if (!res.ok && res.status !== 400) throw new Error(await errorFrom(res));
    const result = (await res.json()) as ImportReport;
    setReport(result);
    setCheckedText(bundleText);
    return result;
  };

  const check = async (bundleText = text) => {
    if (!bundleText.trim()) { setMessage('Choose a file or paste the JSON first.'); return; }
    setBusy(true);
    setMessage(null);
    try { await send(bundleText, true); } catch (err) { setMessage(err instanceof Error ? err.message : 'The check failed.'); } finally { setBusy(false); }
  };

  const chooseFile = async () => {
    setMessage(null);
    try {
      const picked = await pickTextFile({ accept: '.json,application/json', maxBytes: MAX_FILE_BYTES });
      if (!picked) return;
      setText(picked.text);
      setFileName(picked.name);
      setReport(null);
      await check(picked.text);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to read the file.');
    }
  };

  const importNow = async () => {
    // The button is disabled in these cases too; this keeps the rule in one place no matter how the handler is reached.
    if (!canImport) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await send(text, false);
      if (result?.applied) {
        setMessage('Imported. Travelers see these templates now.');
        await loadTemplates();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'The import failed.');
    } finally {
      setBusy(false);
    }
  };

  const removeImport = async (id: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${base}/imported/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error(await errorFrom(res));
      setConfirmRemove(null);
      setMessage(`Removed the imported version of ${id}.`);
      await loadTemplates();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to remove the import.');
    } finally {
      setBusy(false);
    }
  };

  const pillStyle = (status: ImportStatus) => [s.pill, status === 'new' ? s.pillNew : status === 'updated' ? s.pillUpdated : status === 'invalid' ? s.pillInvalid : s.pillUnchanged];

  return (
    <View testID="admin-trip-templates" style={s.root}>
      <Text style={s.title} accessibilityRole="header">Itinerary templates</Text>
      <Text style={s.helper}>
        Sample itineraries are written outside the app by an LLM, saved as one JSON file, checked here, then imported so travelers see them without a deploy.
      </Text>
      {message ? <Text testID="trip-templates-message" style={s.message}>{message}</Text> : null}

      <View style={s.card}>
        <Text style={s.cardTitle}>1. Give the LLM its instructions</Text>
        <Text style={s.helper}>Give an LLM the instructions and the example (and the schema, if it can use one), then tell it which destinations and trip lengths you want.</Text>
        <View style={s.row}>
          <TouchableOpacity testID="trip-templates-download-instructions" accessibilityRole="button" style={s.button} onPress={() => void download('/authoring/instructions', 'wanderbunnies-itinerary-instructions.md', 'text/markdown')}>
            <Text style={s.buttonText}>Download instructions</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="trip-templates-download-example" accessibilityRole="button" style={s.outlineButton} onPress={() => void download('/authoring/example', 'wanderbunnies-itinerary-example.json', 'application/json')}>
            <Text style={s.outlineButtonText}>Download example</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="trip-templates-download-schema" accessibilityRole="button" style={s.outlineButton} onPress={() => void download('/authoring/schema', 'wanderbunnies-itinerary-schema.json', 'application/json')}>
            <Text style={s.outlineButtonText}>Download schema</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>2. Import the result</Text>
        <Text style={s.helper}>Choose the JSON file the LLM produced, or paste it. It is checked first; nothing changes until you press Import, and nothing is saved unless the whole file is acceptable.</Text>
        <View style={s.row}>
          <TouchableOpacity testID="trip-templates-pick-file" accessibilityRole="button" style={s.button} onPress={() => void chooseFile()} disabled={busy}>
            <Text style={s.buttonText}>Choose file…</Text>
          </TouchableOpacity>
          {fileName ? <Text style={s.mutedText}>{fileName}</Text> : null}
        </View>
        <TextInput
          testID="trip-templates-json"
          accessibilityLabel="Template bundle JSON"
          style={s.input}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="…or paste the bundle JSON here"
          value={text}
          onChangeText={(value: string) => { setText(value); setReport(null); setFileName(''); }}
        />
        <View style={s.row}>
          <TouchableOpacity testID="trip-templates-check" accessibilityRole="button" style={s.outlineButton} onPress={() => void check()} disabled={busy || !text.trim()}>
            <Text style={s.outlineButtonText}>Check</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="trip-templates-import" accessibilityRole="button" accessibilityState={{ disabled: !canImport }} style={canImport ? s.button : s.disabledButton} onPress={() => void importNow()} disabled={!canImport}>
            <Text style={canImport ? s.buttonText : s.disabledButtonText}>Import</Text>
          </TouchableOpacity>
          {busy ? <ActivityIndicator accessibilityLabel="Working" /> : null}
        </View>

        {report ? (
          <View testID="trip-templates-report" style={s.report}>
            {report.fatal?.map((problem) => <Text key={problem} selectable style={s.errorText}>{problem}</Text>)}
            {!report.fatal ? (
              <Text style={report.ok ? s.successText : s.errorText} testID="trip-templates-summary">
                {report.applied ? 'Imported: ' : report.ok ? 'Ready to import: ' : 'Not importable yet: '}{countLine(report)}
              </Text>
            ) : null}
            {report.templates.map((template) => (
              <View key={template.id} testID={`trip-templates-result-${template.id}`} style={s.resultRow}>
                <View style={s.row}>
                  <Text style={pillStyle(template.status)}>{STATUS_LABEL[template.status]}</Text>
                  <Text style={s.resultTitle}>{template.title || template.id}</Text>
                </View>
                <Text style={s.mutedText}>{template.id}{template.source === 'bundled' && template.status === 'updated' ? ' · replaces the built-in version' : ''}{template.source === 'bundled' && template.status === 'unchanged' ? ' · same as the built-in version' : ''}</Text>
                {template.errors.map((error) => <Text key={error} selectable style={s.errorText}>• {error}</Text>)}
                {template.warnings.map((warning) => <Text key={warning} selectable style={s.warningText}>• {warning}</Text>)}
              </View>
            ))}
            {(['places', 'destinations'] as const).flatMap((kind) => report.media[kind].rejected.map((item) => (
              <Text key={`${kind}-${item.key}`} selectable style={s.errorText}>• {kind === 'places' ? 'Place' : 'Destination'} {item.key}: {item.error}</Text>
            )))}
            {!report.ok && !report.fatal ? <Text style={s.helper}>Copy these messages back to the LLM and ask for the complete corrected file.</Text> : null}
          </View>
        ) : null}
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>3. Templates in the app</Text>
        <Text style={s.helper}>Download them all (or one) to improve with an LLM, then import the result: a template keeps its id, so it is updated in place.</Text>
        <View style={s.row}>
          <TouchableOpacity testID="trip-templates-download-all" accessibilityRole="button" style={s.button} onPress={() => void download('/export', `wanderbunnies-templates-${stamp}.json`, 'application/json')}>
            <Text style={s.buttonText}>Download all templates</Text>
          </TouchableOpacity>
        </View>
        {listError ? <Text style={s.errorText}>{listError}</Text> : null}
        {templates.map((template) => (
          <View key={template.id} testID={`trip-templates-row-${template.id}`} style={s.resultRow}>
            <Text style={s.resultTitle}>{template.title}</Text>
            <Text style={s.mutedText}>{template.id} · {template.days} days · {template.countries.join(', ')} · {template.activityCount} activities · {SOURCE_LABEL[template.source]}{template.enabled ? '' : ' · switched off'}</Text>
            <View style={s.row}>
              <TouchableOpacity testID={`trip-templates-download-${template.id}`} accessibilityRole="button" style={s.outlineButton} onPress={() => void download(`/export?ids=${encodeURIComponent(template.id)}`, `${template.id}.json`, 'application/json')}>
                <Text style={s.outlineButtonText}>Download</Text>
              </TouchableOpacity>
              {template.source !== 'bundled' ? (confirmRemove === template.id ? (
                <>
                  <TouchableOpacity testID={`trip-templates-remove-confirm-${template.id}`} accessibilityRole="button" style={s.dangerButton} onPress={() => void removeImport(template.id)} disabled={busy}>
                    <Text style={s.dangerButtonText}>Confirm remove</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" style={s.outlineButton} onPress={() => setConfirmRemove(null)}>
                    <Text style={s.outlineButtonText}>Keep</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity testID={`trip-templates-remove-${template.id}`} accessibilityRole="button" style={s.outlineButton} onPress={() => setConfirmRemove(template.id)}>
                  <Text style={s.outlineButtonText}>{template.source === 'imported-override' ? 'Restore built-in' : 'Remove'}</Text>
                </TouchableOpacity>
              )) : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
};

export default TripTemplatesSection;
