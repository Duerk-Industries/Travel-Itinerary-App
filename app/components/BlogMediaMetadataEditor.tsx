import React, { useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import AutoGrowTextInput from './AutoGrowTextInput';
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';

export type BlogMediaMetadataPatch = { caption: string; altText: string; isDecorative: boolean; tags: string[] };

type RecordingState = 'idle' | 'recording' | 'transcribing';

type Props = {
  item: any;
  canSuggest?: boolean;
  canRecord?: boolean;
  busy?: boolean;
  onSave: (patch: BlogMediaMetadataPatch) => Promise<void>;
  onSuggest?: () => Promise<{ caption?: string; altText?: string }>;
  onTranscribe?: (recording: { uri: string; mimeType?: string; name?: string }) => Promise<{ caption?: string }>;
  textColor?: string;
  mutedColor?: string;
  borderColor?: string;
  backgroundColor?: string;
  styles?: any;
  theme?: any;
};

const BlogMediaMetadataEditor: React.FC<Props> = ({
  item, canSuggest = false, canRecord = false, busy = false, onSave, onSuggest, onTranscribe, textColor = '#111827',
  mutedColor = '#6b7280', borderColor = '#d1d5db', backgroundColor = '#fff', styles, theme,
}) => {
  const accentColor = theme?.colors?.link ?? '#7c3aed';
  const [caption, setCaption] = useState('');
  const [altText, setAltText] = useState('');
  const [isDecorative, setIsDecorative] = useState(false);
  const [tags, setTags] = useState('');
  const [notice, setNotice] = useState('');
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  useEffect(() => {
    setCaption(String(item?.caption ?? ''));
    setAltText(String(item?.altText ?? ''));
    setIsDecorative(Boolean(item?.isDecorative));
    setTags(Array.isArray(item?.tags) ? item.tags.join(', ') : '');
    setNotice('');
    setRecordingState('idle');
  }, [item?.assetId, item?.caption, item?.altText, item?.isDecorative, item?.tags]);

  const suggest = async () => {
    if (!onSuggest || busy) return;
    try {
      const result = await onSuggest();
      if (result.caption) setCaption(result.caption);
      if (result.altText) { setAltText(result.altText); setIsDecorative(false); }
      setNotice('AI suggestion added as a draft. Review it before saving.');
    } catch (error: any) {
      setNotice(error?.message || 'Unable to suggest text');
    }
  };

  // Dictate a caption: record a short clip, then hand it off for transcription + AI cleanup. Only
  // ever drafts into the caption field below, same as suggest() above — the traveler still has to
  // review and press Save.
  const toggleRecording = async () => {
    if (!onTranscribe || busy) return;
    if (recordingState === 'idle') {
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          setNotice('Microphone access is needed to record a caption.');
          return;
        }
        // iOS (and Android) refuse to record at all until the app's audio session is explicitly
        // switched into a recording-capable mode -- recorder.record() otherwise throws
        // RecordingDisabledException: "Recording not allowed on iOS."
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        setRecordingState('recording');
        setNotice('Recording… tap Stop when done.');
      } catch (error: any) {
        setNotice(error?.message || 'Unable to start recording');
      }
      return;
    }
    if (recordingState === 'recording') {
      setRecordingState('transcribing');
      setNotice('Transcribing…');
      try {
        await recorder.stop();
        const uri = recorder.uri;
        if (!uri) throw new Error('No recording was captured');
        const result = await onTranscribe({ uri, mimeType: 'audio/m4a', name: 'caption-recording.m4a' });
        if (result.caption) setCaption(result.caption);
        // Save stays disabled until alt text is set (or the photo is marked decorative) — the
        // dictation only ever fills the caption, so say so here rather than leaving the Save
        // button silently inert with no explanation (that's exactly what prompted this note).
        setNotice(isDecorative || altText.trim()
          ? 'Transcribed — review it before saving.'
          : 'Transcribed — add alt text (or mark decorative) below, then save.');
      } catch (error: any) {
        setNotice(error?.message || 'Unable to transcribe the recording');
      } finally {
        // Hand the audio session back so playback elsewhere isn't left routed through the
        // recording session.
        try { await setAudioModeAsync({ allowsRecording: false }); } catch { /* best effort */ }
        setRecordingState('idle');
      }
    }
  };

  const save = async () => {
    try {
      await onSave({ caption: caption.trim().slice(0, 500), tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean), altText: isDecorative ? '' : altText.trim().slice(0, 1000), isDecorative });
      setNotice('Saved');
    } catch (error: any) {
      setNotice(error?.message || 'Unable to save photo details');
    }
  };

  return (
    <View testID="blog-media-metadata-editor" style={{ marginTop: 10, borderWidth: 1, borderColor, borderRadius: 8, padding: 10, backgroundColor }}>
      <Text style={{ color: textColor, fontWeight: '700' }}>Photo details</Text>
      <AutoGrowTextInput
        testID="blog-media-caption-input"
        value={caption}
        onChangeText={(value) => setCaption(value.slice(0, 500))}
        placeholder="Add a caption"
        placeholderTextColor={mutedColor}
        minHeight={38}
        maxLines={6}
        lineHeight={20}
        style={{ color: textColor, borderWidth: 1, borderColor, borderRadius: 6, padding: 8, marginTop: 8, lineHeight: 20 }}
      />
      <TextInput
        testID="blog-media-tags-input"
        value={tags}
        onChangeText={(value) => setTags(value.slice(0, 720))}
        placeholder="Tags (optional, comma-separated)"
        placeholderTextColor={mutedColor}
        style={{ color: textColor, borderWidth: 1, borderColor, borderRadius: 6, padding: 8, marginTop: 8 }}
      />
      <AutoGrowTextInput
        testID="blog-media-alt-text-input"
        value={altText}
        editable={!isDecorative}
        onChangeText={(value) => setAltText(value.slice(0, 1000))}
        placeholder={isDecorative ? 'Not required for a decorative image' : 'Describe the image for screen-reader users'}
        placeholderTextColor={mutedColor}
        minHeight={38}
        maxLines={6}
        lineHeight={20}
        style={{ color: textColor, opacity: isDecorative ? 0.55 : 1, borderWidth: 1, borderColor, borderRadius: 6, padding: 8, marginTop: 8, lineHeight: 20 }}
      />
      <TouchableOpacity testID="blog-media-decorative-toggle" accessibilityRole="checkbox" accessibilityState={{ checked: isDecorative }} onPress={() => { setIsDecorative((value) => !value); setNotice(''); }} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
        <Text style={{ color: textColor, marginRight: 6 }}>{isDecorative ? '☑' : '☐'}</Text>
        <Text style={{ color: mutedColor }}>Decorative image (no alt text needed)</Text>
      </TouchableOpacity>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        <TouchableOpacity testID="blog-media-save-metadata" disabled={busy || (!isDecorative && !altText.trim())} onPress={save} style={[styles?.button, !isDecorative && !altText.trim() ? { opacity: 0.5 } : null]}>
          <Text style={styles?.buttonText}>{busy ? 'Saving…' : 'Save details'}</Text>
        </TouchableOpacity>
        {canSuggest ? (
          <TouchableOpacity testID="blog-media-suggest-metadata" disabled={busy} onPress={suggest} style={[styles?.button, { backgroundColor: accentColor }]}>
            <Text style={styles?.buttonText}>{busy ? 'Working…' : 'Suggest with AI'}</Text>
          </TouchableOpacity>
        ) : null}
        {canRecord ? (
          <TouchableOpacity
            testID="blog-media-record-caption"
            disabled={busy || recordingState === 'transcribing'}
            onPress={toggleRecording}
            style={[styles?.button, { backgroundColor: recordingState === 'recording' ? '#b91c1c' : accentColor }]}
          >
            <Text style={styles?.buttonText}>
              {recordingState === 'recording' ? '● Stop' : recordingState === 'transcribing' ? 'Transcribing…' : '🎙 Record caption'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={{ color: mutedColor, fontSize: 12, marginTop: 6 }}>{notice}</Text>
      ) : !busy && !isDecorative && !altText.trim() ? (
        <Text accessibilityLiveRegion="polite" style={{ color: mutedColor, fontSize: 12, marginTop: 6 }}>
          Add alt text (or mark this photo decorative) to save — it's required so screen readers can describe it.
        </Text>
      ) : null}
    </View>
  );
};

export default BlogMediaMetadataEditor;
