import React, { useEffect, useState } from 'react';
import { Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';

export type ActivityRecapTarget = {
  id: string;
  name: string;
  date: string;
  status?: string | null;
  userRating?: -1 | 1 | null;
};

type Props = {
  visible: boolean;
  activity: ActivityRecapTarget | null;
  styles: Record<string, any>;
  theme?: any;
  onClose: () => void;
  onSave: (input: { rating: -1 | 1 | null; note: string; tags: string[] }) => Promise<void>;
  onAddMedia: (input: { tags: string[] }) => Promise<void> | void;
};

const splitTags = (value: string): string[] => Array.from(new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean)));

// Shared by the manual itinerary action and a completion-notification tap. The mandatory
// activity-name tag makes recap media and notes easy to find later, while the optional field
// lets travelers add their own associations.
const ActivityRecapDialog: React.FC<Props> = ({ visible, activity, styles, theme, onClose, onSave, onAddMedia }) => {
  const [rating, setRating] = useState<-1 | 1 | null>(null);
  const [note, setNote] = useState('');
  const [extraTags, setExtraTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const textColor = theme?.colors?.text ?? '#111827';
  const mutedColor = theme?.colors?.textMuted ?? '#6b7280';
  const borderColor = theme?.colors?.border ?? '#d1d5db';
  const surface = theme?.colors?.surface ?? '#fff';
  const activityTag = String(activity?.name ?? '').trim();
  const tags = activityTag ? [activityTag, ...splitTags(extraTags).filter((tag) => tag.toLowerCase() !== activityTag.toLowerCase())] : splitTags(extraTags);

  useEffect(() => {
    if (!visible) return;
    setRating(activity?.userRating ?? null);
    setNote('');
    setExtraTags('');
    setError('');
  }, [visible, activity?.id, activity?.userRating]);

  const save = async (thenAddMedia = false) => {
    if (!activity) return;
    setBusy(true);
    setError('');
    try {
      // An existing rating is not re-submitted: the current server endpoint intentionally accepts
      // one completed-activity vote per traveler.
      await onSave({ rating: activity.userRating == null ? rating : null, note: note.trim(), tags });
      if (thenAddMedia) await onAddMedia({ tags });
      else onClose();
    } catch (cause: any) {
      setError(cause?.message || 'Unable to save this recap.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay} testID="activity-recap-dialog">
        <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={busy ? undefined : onClose} />
        <View style={[styles.modalCard, { marginTop: 0, backgroundColor: surface }]}>
          <Text style={[styles.sectionTitle, { color: textColor }]}>Recap activity</Text>
          <Text style={{ color: textColor, fontWeight: '700', marginTop: 6 }}>{activity?.name || 'Activity'}</Text>
          <Text style={{ color: mutedColor, marginTop: 2 }}>Rate it, then add a note or photos/videos to the trip blog.</Text>

          {activity?.userRating == null ? (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: rating === 1 }} onPress={() => setRating(1)} style={[styles.button, rating === 1 && { backgroundColor: theme?.colors?.link ?? '#0ea5e9' }]}>
                <Text style={styles.buttonText}>👍 Loved it</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: rating === -1 }} onPress={() => setRating(-1)} style={[styles.button, rating === -1 && { backgroundColor: '#b91c1c' }]}>
                <Text style={styles.buttonText}>👎 Not for me</Text>
              </TouchableOpacity>
            </View>
          ) : <Text style={{ color: mutedColor, marginTop: 14 }}>You already rated this activity.</Text>}

          <TextInput
            testID="activity-recap-note"
            value={note}
            onChangeText={setNote}
            placeholder="Add a note to the trip blog (optional)"
            placeholderTextColor={mutedColor}
            multiline
            style={{ color: textColor, borderWidth: 1, borderColor, borderRadius: 8, padding: 10, minHeight: 88, marginTop: 14, textAlignVertical: 'top' }}
          />
          <Text style={{ color: mutedColor, fontSize: 12, marginTop: 8 }}>Activity tag: #{activityTag || 'activity'}</Text>
          <TextInput
            testID="activity-recap-tags"
            value={extraTags}
            onChangeText={setExtraTags}
            placeholder="More tags (optional, comma-separated)"
            placeholderTextColor={mutedColor}
            style={{ color: textColor, borderWidth: 1, borderColor, borderRadius: 8, padding: 10, marginTop: 6 }}
          />
          {error ? <Text style={{ color: '#b91c1c', marginTop: 8 }}>{error}</Text> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            <TouchableOpacity testID="activity-recap-save" disabled={busy} onPress={() => save(false)} style={[styles.button, busy && { opacity: 0.6 }]}>
              <Text style={styles.buttonText}>{busy ? 'Saving…' : 'Save recap'}</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="activity-recap-add-media" disabled={busy} onPress={() => save(true)} style={[styles.button, { backgroundColor: theme?.colors?.link ?? '#0ea5e9' }, busy && { opacity: 0.6 }]}>
              <Text style={styles.buttonText}>Add photos/videos</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={busy} onPress={onClose} style={[styles.button, { backgroundColor: theme?.colors?.surfaceMuted ?? '#e5e7eb' }]}>
              <Text style={{ color: textColor }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default ActivityRecapDialog;
