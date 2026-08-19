import React, { useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { AppTheme } from '../theme/theme';

type PreviewItem = { type: string; id: string | null; summary: string };
type ImportResult = {
  added: PreviewItem[];
  skippedDuplicates: PreviewItem[];
  skippedUnparseable: Array<PreviewItem & { reason: string }>;
  notesPreview: string | null;
  notesAppended: boolean;
};

type Props = {
  backendUrl: string;
  headers: Record<string, string>;
  tripId: string;
  userTier?: string | null;
  featureEnabled: boolean;
  styles: Record<string, any>;
  readOnly?: boolean;
  theme?: AppTheme;
  onImported: () => void | Promise<void>;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  hideTrigger?: boolean;
};

const WebFileInput = 'input' as any;

export const canShowItineraryDocumentImport = (params: {
  featureEnabled: boolean;
  userTier?: string | null;
  platform: string;
  readOnly?: boolean;
}): boolean => params.featureEnabled
  && params.platform === 'web'
  && !params.readOnly
  && ['premium', 'pro'].includes(String(params.userTier ?? '').toLowerCase());

export const ItineraryDocumentImport: React.FC<Props> = ({
  backendUrl, headers, tripId, userTier, featureEnabled, styles, readOnly = false, theme, onImported,
  expanded: controlledExpanded, onExpandedChange, hideTrigger = false,
}) => {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = controlledExpanded ?? internalExpanded;
  const setExpanded = (value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(expanded) : value;
    setInternalExpanded(next);
    onExpandedChange?.(next);
  };
  const [documentText, setDocumentText] = useState('');
  const [sourceFilename, setSourceFilename] = useState('pasted itinerary.txt');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!canShowItineraryDocumentImport({ featureEnabled, userTier, platform: Platform.OS, readOnly })) {
    return null;
  }

  const JOB_POLL_INTERVAL_MS = 3000;
  const JOB_POLL_TIMEOUT_MS = 5 * 60 * 1000;
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // The import (OCR / PDF extraction plus LLM extraction) routinely takes over a minute,
  // which exceeds Firebase Hosting's fixed ~60s rewrite-to-Cloud-Run timeout -- Hosting
  // would return its own 502 well before a synchronous request finished. The server queues
  // the work as a background job and returns immediately; this polls for completion the
  // same way itinerary generation's async job does (see useAsyncItineraryPolling.ts).
  const pollJob = async (jobId: string): Promise<any> => {
    const deadline = Date.now() + JOB_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await delay(JOB_POLL_INTERVAL_MS);
      const response = await fetch(`${backendUrl}/api/trips/${tripId}/import-document/${encodeURIComponent(jobId)}`, {
        headers, cache: 'no-store',
      } as any);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Unable to check import status (HTTP ${response.status})`);
      }
      if (data.status === 'completed') return data.result;
      if (data.status === 'failed') throw new Error(data.error || 'Unable to import this document.');
    }
    throw new Error('This document is taking longer than expected. Check back shortly and try again.');
  };

  const submit = async (dryRun: boolean) => {
    if (!selectedFile && !documentText.trim()) {
      setErrorMessage('Paste itinerary text or choose a document first.');
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);
    if (dryRun) setPreview(null);
    setBusy(true);
    try {
      let body: BodyInit;
      let requestHeaders: Record<string, string>;
      if (selectedFile) {
        const form = new FormData();
        form.append('file', selectedFile);
        form.append('dryRun', String(dryRun));
        body = form;
        requestHeaders = { ...headers };
        delete requestHeaders['Content-Type'];
        delete requestHeaders['content-type'];
      } else {
        body = JSON.stringify({ documentText, sourceFilename, dryRun });
        requestHeaders = { 'Content-Type': 'application/json', ...headers };
      }
      const response = await fetch(`${backendUrl}/api/trips/${tripId}/import-document`, {
        method: 'POST', headers: requestHeaders, body,
      });
      const submitData = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = submitData.code === 'FEATURE_DISABLED'
          ? 'Document import is currently disabled by its feature flag. Enable itinerary_document_import in Admin, then try again.'
          : submitData.error || `Unable to import this document (HTTP ${response.status})`;
        throw new Error(message);
      }
      const data = await pollJob(submitData.jobId);
      setPreview(data);
      if (!dryRun) {
        await onImported();
        setDocumentText('');
        setSelectedFile(null);
        const message = `Document imported: ${data.added?.length ?? 0} item(s) added.`;
        setSuccessMessage(message);
        if (Platform.OS !== 'web') Alert.alert('Document imported', message);
      }
    } catch (error) {
      setErrorMessage((error as Error).message || 'Unable to import this document.');
    } finally {
      setBusy(false);
    }
  };

  const fileInputColor = theme?.colors.text
    ?? StyleSheet.flatten(styles.bodyText)?.color
    ?? StyleSheet.flatten(styles.helperText)?.color
    ?? '#ffffff';

  return (
    <View testID="itinerary-document-import" style={{ gap: 10 }}>
      {!hideTrigger ? (
        <TouchableOpacity style={[styles.button, styles.smallButton, { alignSelf: 'flex-start' }]} onPress={() => setExpanded((value) => !value)}>
          <Text style={styles.buttonText}>{expanded ? 'Close itinerary import' : 'Import Itinerary'}</Text>
        </TouchableOpacity>
      ) : null}
      {expanded ? (
        <View style={[styles.card, { gap: 10, padding: 12 }]}>
          <Text style={styles.headerText}>Import itinerary document</Text>
          <Text style={styles.helperText}>Paste text or choose a PDF, Markdown, or text file. You will preview changes before anything is saved.</Text>
          <TextInput
            testID="itinerary-import-text"
            style={[styles.input, { minHeight: 140, textAlignVertical: 'top' }]}
            multiline
            placeholder="Paste reservations or itinerary text"
            value={documentText}
            onChangeText={(value) => { setDocumentText(value); setSelectedFile(null); setPreview(null); }}
          />
          <WebFileInput
            data-testid="itinerary-import-file"
            type="file"
            accept=".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain"
            aria-label="Choose itinerary document"
            style={{ color: fileInputColor, colorScheme: theme?.mode ?? 'light' }}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              const file = event.target.files?.[0] ?? null;
              setSelectedFile(file);
              if (file) setSourceFilename(file.name);
              setPreview(null);
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
          />
          {selectedFile ? <Text style={styles.helperText}>Selected: {selectedFile.name}</Text> : null}
          <TouchableOpacity
            testID="itinerary-import-preview"
            disabled={busy}
            style={[styles.button, styles.smallButton, busy ? { opacity: 0.6 } : null]}
            onPress={() => submit(true)}
          >
            <Text style={styles.buttonText}>{busy ? 'Analyzing document…' : 'Preview import'}</Text>
          </TouchableOpacity>
          {busy ? (
            <View accessibilityLiveRegion="polite" style={{ alignItems: 'center', gap: 6 }}>
              <ActivityIndicator color={fileInputColor} />
              <Text style={styles.helperText}>Extracting itinerary items. Large PDFs can take up to a minute.</Text>
            </View>
          ) : null}
          {errorMessage ? (
            <View testID="itinerary-import-error" accessibilityRole="alert" style={{ paddingVertical: 8 }}>
              <Text style={styles.dangerButtonText ?? styles.bodyText}>{errorMessage}</Text>
            </View>
          ) : null}
          {successMessage ? <Text testID="itinerary-import-success" style={styles.bodyText}>{successMessage}</Text> : null}
          {preview ? (
            <View testID="itinerary-import-preview-results" style={{ gap: 6 }}>
              <Text style={styles.headerText}>Preview</Text>
              {preview.added.map((item, index) => <Text key={`add-${index}`} style={styles.bodyText}>Add {item.type.replace(/_/g, ' ')}: {item.summary}</Text>)}
              {preview.skippedDuplicates.map((item, index) => <Text key={`dup-${index}`} style={styles.helperText}>Already present: {item.summary}</Text>)}
              {preview.skippedUnparseable.map((item, index) => <Text key={`bad-${index}`} style={styles.helperText}>Skipped {item.summary}: {item.reason}</Text>)}
              {preview.notesPreview ? <Text style={styles.bodyText}>{preview.notesPreview}</Text> : null}
              <TouchableOpacity
                testID="itinerary-import-confirm"
                disabled={busy}
                style={[styles.button, busy ? { opacity: 0.6 } : null]}
                onPress={() => submit(false)}
              >
                <Text style={styles.buttonText}>Confirm import</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

export default ItineraryDocumentImport;
