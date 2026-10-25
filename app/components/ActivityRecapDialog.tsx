import { resolveComponentTheme as resolveStyleTheme, themeStyle } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Modal from './KeyboardAwareModal';

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
const ActivityRecapDialog: React.FC<Props> = ({ visible, activity, styles, theme: _providedTheme, onClose, onSave, onAddMedia }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [rating, setRating] = useState<-1 | 1 | null>(null);
  const [note, setNote] = useState('');
  const [extraTags, setExtraTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const textColor = theme?.colors?.text ?? themeStyle('components_ActivityRecapDialog_20', {  }, (theme ?? _styleTheme));
  const mutedColor = theme?.colors?.textMuted ?? themeStyle('components_ActivityRecapDialog_21', {  }, (theme ?? _styleTheme));
  const borderColor = theme?.colors?.border ?? themeStyle('components_ActivityRecapDialog_22', {  }, (theme ?? _styleTheme));
  const surface = theme?.colors?.surface ?? themeStyle('components_ActivityRecapDialog_23', {  }, (theme ?? _styleTheme));
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
        <View style={[styles.modalCard, themeStyle('components_ActivityRecapDialog_1', { surface: surface }, (theme ?? _styleTheme))]}>
<ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
          <Text style={[styles.sectionTitle, themeStyle('components_ActivityRecapDialog_2', { textColor: textColor }, (theme ?? _styleTheme))]}>Recap activity</Text>
          <Text style={themeStyle('components_ActivityRecapDialog_3', { textColor: textColor }, (theme ?? _styleTheme))}>{activity?.name || 'Activity'}</Text>
          <Text style={themeStyle('components_ActivityRecapDialog_4', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>Rate it, then add a note or photos/videos to the trip blog.</Text>

          {activity?.userRating == null ? (
            <View style={themeStyle('components_ActivityRecapDialog_5', {  }, (theme ?? _styleTheme))}>
              <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: rating === 1 }} onPress={() => setRating(1)} style={[styles.button, rating === 1 && themeStyle('components_ActivityRecapDialog_6', { theme: theme }, (theme ?? _styleTheme))]}>
                <Text style={styles.buttonText}>👍 Loved it</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: rating === -1 }} onPress={() => setRating(-1)} style={[styles.button, rating === -1 && themeStyle('components_ActivityRecapDialog_7', {  }, (theme ?? _styleTheme))]}>
                <Text style={[styles.buttonText, rating === -1 && themeStyle('components_ActivityRecapDialog_8', {  }, (theme ?? _styleTheme))]}>👎 Not for me</Text>
              </TouchableOpacity>
            </View>
          ) : <Text style={themeStyle('components_ActivityRecapDialog_9', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>You already rated this activity.</Text>}

          <TextInput
            testID="activity-recap-note"
            value={note}
            onChangeText={setNote}
            placeholder="Add a note to the trip blog (optional)"
            placeholderTextColor={mutedColor}
            multiline
            style={themeStyle('components_ActivityRecapDialog_10', { textColor: textColor, borderColor: borderColor }, (theme ?? _styleTheme))}
          />
          <Text style={themeStyle('components_ActivityRecapDialog_11', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>Activity tag: #{activityTag || 'activity'}</Text>
          <TextInput
            testID="activity-recap-tags"
            value={extraTags}
            onChangeText={setExtraTags}
            placeholder="More tags (optional, comma-separated)"
            placeholderTextColor={mutedColor}
            style={themeStyle('components_ActivityRecapDialog_12', { textColor: textColor, borderColor: borderColor }, (theme ?? _styleTheme))}
          />
          {error ? <Text style={themeStyle('components_ActivityRecapDialog_13', { theme: theme }, (theme ?? _styleTheme))}>{error}</Text> : null}
          <View style={themeStyle('components_ActivityRecapDialog_14', {  }, (theme ?? _styleTheme))}>
            <TouchableOpacity testID="activity-recap-save" disabled={busy} onPress={() => save(false)} style={[styles.button, busy && themeStyle('components_ActivityRecapDialog_15', {  }, (theme ?? _styleTheme))]}>
              <Text style={styles.buttonText}>{busy ? 'Saving…' : 'Save recap'}</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="activity-recap-add-media" disabled={busy} onPress={() => save(true)} style={[styles.button, themeStyle('components_ActivityRecapDialog_16', { theme: theme }, (theme ?? _styleTheme)), busy && themeStyle('components_ActivityRecapDialog_17', {  }, (theme ?? _styleTheme))]}>
              <Text style={styles.buttonText}>Add photos/videos</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={busy} onPress={onClose} style={[styles.button, themeStyle('components_ActivityRecapDialog_18', { theme: theme }, (theme ?? _styleTheme))]}>
              <Text style={themeStyle('components_ActivityRecapDialog_19', { textColor: textColor }, (theme ?? _styleTheme))}>Cancel</Text>
            </TouchableOpacity>
          </View>
</ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default ActivityRecapDialog;
