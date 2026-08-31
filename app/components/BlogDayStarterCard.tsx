// @ts-nocheck
// Phase 5 (A1) of docs/trip-blog-social-implementation-plan.md — the Day Starter card.
//
// The server assembles a deterministic draft from that day's itinerary (transfers, activities,
// lodging, car rentals) or, with nothing else, a "N photos from Tuesday" fallback. It is a
// suggestion, never a stored item (FR-A1.2): "Use this draft" accepts it as an editable
// core.text item authored to the tapping user; "Not now" suppresses it for this user and day
// permanently (FR-A1.3).
//
// "Rewrite with AI" (architecture §8) is deliberately not here yet — it belongs behind
// trip_blog_ai_highlights with its own rate-limited endpoint, which does not exist.
import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

type Props = {
  draft: string;
  onUse: () => void;
  onDismiss: () => void;
  busy?: boolean;
  displayFont?: string;
  textColor?: string;
  mutedColor?: string;
  borderColor?: string;
  backgroundColor?: string;
  accentColor?: string;
  styles: any;
  testID?: string;
};

const BlogDayStarterCard: React.FC<Props> = ({
  draft, onUse, onDismiss, busy = false,
  displayFont, textColor = '#111827', mutedColor = '#6b7280',
  borderColor = '#ccd4df', backgroundColor = '#ffffff', accentColor = '#2E96A6',
  styles, testID,
}) => (
  <View
    testID={testID}
    style={{ borderWidth: 1, borderColor, borderRadius: 12, backgroundColor, padding: 14, marginBottom: 12 }}
  >
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <Text style={{ fontFamily: displayFont, color: accentColor, fontSize: 14, fontWeight: '600' }}>✨ Day Starter</Text>
      <TouchableOpacity
        testID={testID ? `${testID}-dismiss` : undefined}
        accessibilityRole="button"
        accessibilityLabel="Dismiss this Day Starter"
        onPress={busy ? undefined : onDismiss}
        disabled={busy}
        style={{ minHeight: 32, minWidth: 32, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ color: mutedColor, fontSize: 16 }}>✕</Text>
      </TouchableOpacity>
    </View>

    <Text style={{ color: textColor, fontSize: 15, lineHeight: 22, marginBottom: 12 }}>{draft}</Text>

    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <TouchableOpacity
        testID={testID ? `${testID}-use` : undefined}
        accessibilityRole="button"
        style={[styles.button, busy ? { opacity: 0.6 } : null]}
        disabled={busy}
        onPress={busy ? undefined : onUse}
      >
        {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.buttonText}>Use this draft</Text>}
      </TouchableOpacity>
      <TouchableOpacity
        testID={testID ? `${testID}-notnow` : undefined}
        accessibilityRole="button"
        style={[styles.button, { backgroundColor: 'transparent', borderWidth: 1, borderColor }]}
        disabled={busy}
        onPress={busy ? undefined : onDismiss}
      >
        <Text style={{ color: textColor }}>Not now</Text>
      </TouchableOpacity>
    </View>
  </View>
);

export default BlogDayStarterCard;
