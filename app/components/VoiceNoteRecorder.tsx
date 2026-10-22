/**
 * VoiceNoteRecorder — records an in-app audio clip and hands it off to the caller, so the trip
 * blog's "+ Voice note" flow no longer requires picking a prerecorded file (see tripBlog.tsx's
 * handleVoiceNote, which stays as the "choose an existing audio file" path — this is additive,
 * not a replacement).
 *
 * Mirrors BlogMediaMetadataEditor.tsx's "Record caption" record/stop lifecycle (same expo-audio
 * APIs, same permission check) but produces a standalone recording rather than drafting into an
 * existing item's caption field.
 */
import React, { useState } from 'react';
import { TouchableOpacity } from 'react-native';
import { ThemedText as Text } from './ThemedText';
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';

export type RecordedVoiceNote = { uri: string; mimeType: string; name: string };

type RecordingState = 'idle' | 'recording' | 'processing';

type Props = {
  disabled?: boolean;
  processingLabel?: string;
  onRecorded: (recording: RecordedVoiceNote) => Promise<void> | void;
  onError?: (message: string) => void;
  style?: any;
  activeStyle?: any;
  textStyle?: any;
  testID?: string;
};

const VoiceNoteRecorder: React.FC<Props> = ({
  disabled = false,
  processingLabel = 'Processing…',
  onRecorded,
  onError,
  style,
  activeStyle,
  textStyle,
  testID = 'blog-record-voice-note',
}) => {
  const [state, setState] = useState<RecordingState>('idle');
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const toggle = async () => {
    if (disabled || state === 'processing') return;
    if (state === 'idle') {
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          onError?.('Microphone access is needed to record a voice note.');
          return;
        }
        // iOS (and Android) refuse to record at all until the app's audio session is explicitly
        // switched into a recording-capable mode -- recorder.record() otherwise throws
        // RecordingDisabledException: "Recording not allowed on iOS."
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        setState('recording');
      } catch (error: any) {
        onError?.(error?.message || 'Unable to start recording');
      }
      return;
    }
    setState('processing');
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('No recording was captured');
      await onRecorded({ uri, mimeType: 'audio/m4a', name: 'voice-note.m4a' });
    } catch (error: any) {
      onError?.(error?.message || 'Unable to process the recording');
    } finally {
      // Hand the audio session back so playback elsewhere (voice note playback, videos) isn't
      // left routed through the recording session.
      try { await setAudioModeAsync({ allowsRecording: false }); } catch { /* best effort */ }
      setState('idle');
    }
  };

  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={state === 'recording' ? 'Stop recording' : 'Record a voice note'}
      disabled={disabled || state === 'processing'}
      onPress={toggle}
      style={[style, state === 'recording' ? activeStyle : null]}
    >
      <Text style={textStyle}>
        {state === 'recording' ? '● Stop' : state === 'processing' ? processingLabel : '🎙 Record'}
      </Text>
    </TouchableOpacity>
  );
};

export default VoiceNoteRecorder;
