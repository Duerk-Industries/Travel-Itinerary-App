import React, { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';

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
  styles: Record<string, any>;
  readOnly?: boolean;
  onImported: () => void | Promise<void>;
};

const WebFileInput = 'input' as any;

export const ItineraryDocumentImport: React.FC<Props> = ({
  backendUrl, headers, tripId, userTier, styles, readOnly = false, onImported,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [documentText, setDocumentText] = useState('');
  const [sourceFilename, setSourceFilename] = useState('pasted itinerary.txt');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  if (Platform.OS !== 'web' || readOnly || !['premium', 'pro'].includes(String(userTier ?? '').toLowerCase())) {
    return null;
  }

  const submit = async (dryRun: boolean) => {
    if (!selectedFile && !documentText.trim()) {
      Alert.alert('Paste itinerary text or choose a document first.');
      return;
    }
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
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to import this document');
      setPreview(data);
      if (!dryRun) {
        await onImported();
        setDocumentText('');
        setSelectedFile(null);
        Alert.alert('Document imported', `${data.added?.length ?? 0} item(s) added.`);
      }
    } catch (error) {
      Alert.alert((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View testID="itinerary-document-import" style={{ gap: 10 }}>
      <TouchableOpacity style={[styles.button, styles.smallButton, { alignSelf: 'flex-start' }]} onPress={() => setExpanded((value) => !value)}>
        <Text style={styles.buttonText}>{expanded ? 'Close document import' : 'Import from document'}</Text>
      </TouchableOpacity>
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
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              const file = event.target.files?.[0] ?? null;
              setSelectedFile(file);
              if (file) setSourceFilename(file.name);
              setPreview(null);
            }}
          />
          {selectedFile ? <Text style={styles.helperText}>Selected: {selectedFile.name}</Text> : null}
          <TouchableOpacity
            testID="itinerary-import-preview"
            disabled={busy}
            style={[styles.button, styles.smallButton, busy ? { opacity: 0.6 } : null]}
            onPress={() => submit(true)}
          >
            <Text style={styles.buttonText}>Preview import</Text>
          </TouchableOpacity>
          {busy ? <ActivityIndicator /> : null}
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
