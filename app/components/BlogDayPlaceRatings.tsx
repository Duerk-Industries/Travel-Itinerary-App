import React, { useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import { placeRatingProblem, saveBlogPlaceRating } from '../utils/blogPlaceRating';
import StarRating from './StarRating';

export type RateableActivity = { id: string; name: string; date: string; userStars?: number | null };

type Props = {
  backendUrl: string;
  headers: Record<string, string>;
  tripId: string;
  /** The day's planned activities. */
  activities: RateableActivity[];
  /** Called after an opinion is filed, so the blog can show the note it added. */
  onNoteAdded?: () => void;
  theme?: any;
};

/**
 * "Rate this place" on each planned activity in a blog day. A tap on a star saves that rating at once, the same 1-5 stars the
 * itinerary shows, so the two always agree; an optional one-line opinion is filed as a note on the day.
 */
const BlogDayPlaceRatings: React.FC<Props> = ({ backendUrl, headers, tripId, activities, onNoteAdded, theme: providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = providedTheme ?? _styleTheme;
  const [stars, setStars] = useState<Record<string, number | null>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Record<string, string>>({});
  if (!activities.length) return null;

  const starsFor = (activity: RateableActivity): number | null => (activity.id in stars ? stars[activity.id] : activity.userStars ?? null);
  const say = (id: string, text: string) => setMessage((current) => ({ ...current, [id]: text }));

  const rate = async (activity: RateableActivity, value: number) => {
    if (busy) return;
    setStars((current) => ({ ...current, [activity.id]: value }));
    setBusy(activity.id); say(activity.id, '');
    try {
      const result = await saveBlogPlaceRating({ backendUrl, headers, tripId, place: { name: activity.name, firstDate: activity.date }, stars: value, note: '' });
      say(activity.id, result.message);
    } catch (error: any) {
      say(activity.id, error?.message || 'Unable to save your rating');
    } finally { setBusy(null); }
  };

  const saveNote = async (activity: RateableActivity) => {
    if (busy) return;
    const note = notes[activity.id] ?? '';
    const place = { name: activity.name, firstDate: activity.date };
    const problem = placeRatingProblem(place, null, note);
    if (problem) { say(activity.id, problem); return; }
    setBusy(activity.id); say(activity.id, '');
    try {
      // The stars were already saved when they were tapped; the note carries the same mark.
      const result = await saveBlogPlaceRating({ backendUrl, headers, tripId, place, stars: null, note });
      say(activity.id, result.message);
      if (result.ok) { setNotes((current) => ({ ...current, [activity.id]: '' })); setNoteOpen(null); onNoteAdded?.(); }
    } catch (error: any) {
      say(activity.id, error?.message || 'Your note could not be saved.');
    } finally { setBusy(null); }
  };

  return (
    <View testID="blog-day-place-ratings" style={themeStyle('components_BlogDayPlaceRatings_1', {}, theme)}>
      <Text style={themeStyle('components_BlogDayPlaceRatings_2', {}, theme)}>Rate this place</Text>
      {activities.map((activity) => (
        <View key={activity.id} style={themeStyle('components_BlogDayPlaceRatings_3', {}, theme)}>
          <Text style={themeStyle('components_BlogDayPlaceRatings_4', {}, theme)}>{activity.name}</Text>
          <StarRating value={starsFor(activity)} size={28} label="Your rating" name={activity.name} theme={theme} testID={`blog-day-rate-${activity.id}`} disabled={busy === activity.id} onChange={(value: number) => rate(activity, value)} />
          {noteOpen === activity.id ? (
            <View>
              <TextInput
                testID={`blog-day-rate-note-${activity.id}`}
                accessibilityLabel={`Your one-line opinion about ${activity.name}`}
                maxLength={280}
                value={notes[activity.id] ?? ''}
                onChangeText={(value) => setNotes((current) => ({ ...current, [activity.id]: value }))}
                placeholder="One line about it"
                style={themeStyle('components_BlogDayPlaceRatings_5', {}, theme)}
              />
              <TouchableOpacity testID={`blog-day-rate-note-save-${activity.id}`} accessibilityRole="button" disabled={Boolean(busy)} onPress={() => saveNote(activity)} style={themeStyle('components_BlogDayPlaceRatings_6', {}, theme)}>
                {busy === activity.id ? <ActivityIndicator /> : <Text style={themeStyle('components_BlogDayPlaceRatings_7', {}, theme)}>Save opinion</Text>}
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity testID={`blog-day-rate-note-open-${activity.id}`} accessibilityRole="button" onPress={() => setNoteOpen(activity.id)}>
              <Text style={themeStyle('components_BlogDayPlaceRatings_8', {}, theme)}>Add a one-line opinion</Text>
            </TouchableOpacity>
          )}
          {message[activity.id] ? <Text accessibilityRole="alert" style={themeStyle('components_BlogDayPlaceRatings_8', {}, theme)}>{message[activity.id]}</Text> : null}
        </View>
      ))}
    </View>
  );
};

export default BlogDayPlaceRatings;
