// @ts-nocheck
// The editorial public-reader page — the frontend `publicBlogRoutes.ts` never had. Reachable at
// the app's own root as a bare two-segment path (`/{username}/{tripSlug}`, matching
// blogRepository.getPublicPath's format), routed to by App.tsx *before* anything auth-related
// mounts. No login, no app chrome, no session — a stranger with the link gets exactly this page.
//
// Deliberately web-only (App.tsx only checks window.location on Platform.OS === 'web'): a public
// link is a browser-shareable artifact, not something native deep-linking needs to solve today.
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useFonts, Fraunces_400Regular, Fraunces_500Medium, Fraunces_600SemiBold, Fraunces_600SemiBold_Italic } from '@expo-google-fonts/fraunces';
import { resolveBackendUrl } from '../utils/backendUrl';
import { formatDateLong } from '../utils/formatDateLong';

type PublicBlogItem = {
  id: string;
  kindKey: string;
  body?: string | null;
  mediaKind?: string | null;
  caption?: string | null;
  altText?: string | null;
  primaryUrl?: string | null;
  thumbnailUrl?: string | null;
};

type PublicBlogDay = {
  localDate: string;
  headline: string | null;
  summary: string | null;
  items: PublicBlogItem[];
};

type PublicBlogPayload = {
  title: string;
  subtitle: string | null;
  introduction: string | null;
  days: PublicBlogDay[];
};

type Props = {
  username: string;
  tripSlug: string;
};

// Mirrors server/src/blog/engagementTypes.ts BLOG_REACTION_EMOJIS / BlogReactionBar's EMOJI_GLYPH.
const REACTION_GLYPH: Record<string, string> = {
  heart: '❤️', laugh: '😂', wow: '😮', fire: '🔥', clap: '👏', thanks: '🙏',
};
const REACTION_ORDER = ['heart', 'laugh', 'wow', 'fire', 'clap', 'thanks'];

type DayEngagement = {
  reactionCounts: Record<string, number>;
  reactionTotal: number;
  commentCount: number;
};

type PublicComment = {
  id: string;
  body: string | null;
  authorRole: string;
  parentCommentId: string | null;
  replyCount: number;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
};

const stripHtml = (html: string): string => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// The sanitized public comment carries authorRole but no identity (server strips id/name/email —
// architecture §5.1). 'owner'/'traveler' both read as "Traveler" to a stranger; anything else is
// a follower.
const ROLE_LABEL = (role: string): string => (role === 'follower' ? 'Follower' : 'Traveler');

const formatCommentWhen = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const COMMENT_PAGE = 20;
const engagementQuery = (params: Record<string, string>): string =>
  Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

// A quiet, read-only tally under each day — reaction counts, and a comment count that expands the
// day's public-audience thread on tap. No compose box and no reaction buttons: a stranger with the
// link sees how the trip's travelers and followers responded but cannot join in here (architecture
// PR-1: no anonymous public commenting).
const DayEngagementFooter: React.FC<{
  data?: DayEngagement;
  bodyFont?: string;
  backendUrl: string;
  username: string;
  tripSlug: string;
  localDate: string;
}> = ({ data, bodyFont, backendUrl, username, tripSlug, localDate }) => {
  const [expanded, setExpanded] = useState(false);
  const [comments, setComments] = useState<PublicComment[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);

  const loadPage = async (cursor?: string) => {
    setLoading(true);
    setFailed(false);
    try {
      const query = engagementQuery({ dayDate: localDate, limit: String(COMMENT_PAGE), ...(cursor ? { cursor } : {}) });
      const response = await fetch(`${backendUrl}/public/blog/${encodeURIComponent(username)}/${encodeURIComponent(tripSlug)}/engagement?${query}`);
      if (!response.ok) { setFailed(true); return; }
      const payload = await response.json();
      const page: PublicComment[] = payload.comments ?? [];
      setComments((prev) => (cursor && prev ? [...prev, ...page] : page));
      // The endpoint returns no next-cursor; a full page means there may be more.
      setHasMore(page.length === COMMENT_PAGE);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const chips = REACTION_ORDER.filter((emoji) => (data?.reactionCounts[emoji] ?? 0) > 0);
  const commentCount = data?.commentCount ?? 0;
  if (!data || (!chips.length && !commentCount)) return null;

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && comments === null && !loading) loadPage();
  };

  return (
    <View style={{ marginTop: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#EEF2F4' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
        {chips.map((emoji) => (
          <View key={emoji} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 14, marginBottom: 4 }}>
            <Text style={{ fontSize: 14 }}>{REACTION_GLYPH[emoji]}</Text>
            <Text style={{ fontFamily: bodyFont, fontSize: 13, color: '#6B7280', marginLeft: 4 }}>{data.reactionCounts[emoji]}</Text>
          </View>
        ))}
        {commentCount ? (
          <Pressable
            onPress={toggle}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            style={{ marginBottom: 4 }}
          >
            <Text style={{ fontFamily: bodyFont, fontSize: 13, color: '#2E96A6' }}>
              💬 {commentCount} {commentCount === 1 ? 'comment' : 'comments'} {expanded ? '▲' : '▼'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {expanded && commentCount ? (
        <View style={{ marginTop: 14 }}>
          {loading && !comments ? (
            <ActivityIndicator size="small" color="#2E96A6" />
          ) : failed && !comments ? (
            <Text style={{ fontFamily: bodyFont, fontSize: 13, color: '#6B7280' }}>Couldn't load comments right now.</Text>
          ) : comments && comments.length ? (
            <>
              {comments.map((comment) => (
                <View key={comment.id} style={{ marginBottom: 14 }}>
                  <Text style={{ fontFamily: bodyFont, fontSize: 12, color: '#94A0AC', marginBottom: 3 }}>
                    {ROLE_LABEL(comment.authorRole)} · {formatCommentWhen(comment.createdAt)}{comment.editedAt ? ' (edited)' : ''}
                  </Text>
                  <Text style={{ fontFamily: bodyFont, fontSize: 15, lineHeight: 22, color: comment.deletedAt || comment.body == null ? '#94A0AC' : '#111827', fontStyle: comment.deletedAt || comment.body == null ? 'italic' : 'normal' }}>
                    {comment.deletedAt || comment.body == null ? 'This comment was removed.' : comment.body}
                  </Text>
                  {comment.replyCount > 0 ? (
                    <Text style={{ fontFamily: bodyFont, fontSize: 12, color: '#94A0AC', marginTop: 3 }}>
                      {comment.replyCount} {comment.replyCount === 1 ? 'reply' : 'replies'}
                    </Text>
                  ) : null}
                </View>
              ))}
              {hasMore ? (
                <Pressable onPress={() => loadPage(comments[comments.length - 1]?.id)} accessibilityRole="button" disabled={loading}>
                  <Text style={{ fontFamily: bodyFont, fontSize: 13, color: '#2E96A6', marginTop: 2 }}>
                    {loading ? 'Loading…' : 'Show more comments'}
                  </Text>
                </Pressable>
              ) : null}
              {failed ? (
                <Text style={{ fontFamily: bodyFont, fontSize: 13, color: '#6B7280', marginTop: 4 }}>Couldn't load more comments.</Text>
              ) : null}
            </>
          ) : (
            <Text style={{ fontFamily: bodyFont, fontSize: 13, color: '#6B7280' }}>No public comments on this day.</Text>
          )}
        </View>
      ) : null}
    </View>
  );
};

const PublicTripBlogPage: React.FC<Props> = ({ username, tripSlug }) => {
  const [fontsLoaded] = useFonts({ Fraunces_400Regular, Fraunces_500Medium, Fraunces_600SemiBold, Fraunces_600SemiBold_Italic });
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'not-found' | 'error'; blog: PublicBlogPayload | null; message: string | null }>({
    status: 'loading', blog: null, message: null,
  });

  const backendUrl = useMemo(() => resolveBackendUrl({
    appConfigured: Constants.expoConfig?.extra?.backendUrl,
    envConfigured: (typeof process !== 'undefined' && (process.env.EXPO_PUBLIC_BACKEND_URL ?? process.env.BACKEND_URL)) || '',
    nodeEnv: typeof process !== 'undefined' ? process.env.NODE_ENV : undefined,
    platformOs: Platform.OS,
    browserLocation: Platform.OS === 'web' && typeof window !== 'undefined' ? window.location : undefined,
  }), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${backendUrl}/public/blog/${encodeURIComponent(username)}/${encodeURIComponent(tripSlug)}`);
        if (cancelled) return;
        if (response.status === 404) {
          setState({ status: 'not-found', blog: null, message: null });
          return;
        }
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          setState({ status: 'error', blog: null, message: data.error || 'Unable to load this trip blog right now.' });
          return;
        }
        const data = await response.json();
        setState({ status: 'ready', blog: data, message: null });
      } catch {
        if (!cancelled) setState({ status: 'error', blog: null, message: 'Unable to load this trip blog right now.' });
      }
    })();
    return () => { cancelled = true; };
  }, [backendUrl, username, tripSlug]);

  // Read-only public engagement — public-audience reaction counts and comment counts per day, on
  // its own endpoint/flag/cache (architecture §5.1/§14.7). A separate request from the document
  // fetch above so an engagement change never busts the CDN-cached prose. Joined to rendered days
  // by localDate (the document endpoint doesn't expose day ids; this endpoint is keyed by date).
  // A 404 here means trip_blog_public_engagement is off — render the page exactly as before.
  const [engagement, setEngagement] = useState<Record<string, DayEngagement>>({});
  useEffect(() => {
    if (state.status !== 'ready') return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${backendUrl}/public/blog/${encodeURIComponent(username)}/${encodeURIComponent(tripSlug)}/engagement`);
        if (cancelled || !response.ok) return;
        const data = await response.json();
        const map: Record<string, DayEngagement> = {};
        for (const day of data.days ?? []) {
          map[day.localDate] = {
            reactionCounts: day.reactionCounts ?? {},
            reactionTotal: day.reactionTotal ?? 0,
            commentCount: day.commentCount ?? 0,
          };
        }
        if (!cancelled) setEngagement(map);
      } catch {
        // Non-fatal: the page reads fine without engagement.
      }
    })();
    return () => { cancelled = true; };
  }, [backendUrl, username, tripSlug, state.status]);

  // The trip's own most-loved photo isn't in this payload (no engagement data on the public
  // document endpoint) — the first available photo, in day order, is a reasonable stand-in for a
  // cover image without a second request.
  const coverPhoto = useMemo(() => {
    for (const day of state.blog?.days ?? []) {
      const photo = day.items.find((item) => item.mediaKind === 'photo' && item.primaryUrl);
      if (photo) return photo;
    }
    return null;
  }, [state.blog]);

  const displayFont = fontsLoaded ? 'Fraunces_600SemiBold' : undefined;
  const displayFontItalic = fontsLoaded ? 'Fraunces_600SemiBold_Italic' : undefined;
  const bodyDisplayFont = fontsLoaded ? 'Fraunces_400Regular' : undefined;

  if (state.status === 'loading') {
    return (
      <View style={{ flex: 1, minHeight: '100vh' as any, backgroundColor: '#FAFCFD', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#2E96A6" />
      </View>
    );
  }

  if (state.status === 'not-found') {
    return (
      <View style={{ flex: 1, minHeight: '100vh' as any, backgroundColor: '#FAFCFD', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontFamily: displayFont, fontSize: 26, color: '#152944', marginBottom: 8, textAlign: 'center' }}>This trip blog isn't public</Text>
        <Text style={{ color: '#6B7280', fontSize: 15, textAlign: 'center', maxWidth: 420 }}>
          The link may be out of date, or the traveler may have made this trip private again.
        </Text>
      </View>
    );
  }

  if (state.status === 'error' || !state.blog) {
    return (
      <View style={{ flex: 1, minHeight: '100vh' as any, backgroundColor: '#FAFCFD', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontFamily: displayFont, fontSize: 22, color: '#152944', marginBottom: 8, textAlign: 'center' }}>Something went wrong</Text>
        <Text style={{ color: '#6B7280', fontSize: 15, textAlign: 'center', maxWidth: 420 }}>{state.message || 'Please try again in a moment.'}</Text>
      </View>
    );
  }

  const blog = state.blog;
  const daysWithContent = blog.days.filter((day) => day.headline || day.summary || day.items.length > 0);

  return (
    <View style={{ flex: 1, backgroundColor: '#FAFCFD' }}>
      {coverPhoto ? (
        <View style={{ width: '100%', aspectRatio: 16 / 7, backgroundColor: '#152944' }}>
          <Image source={{ uri: coverPhoto.primaryUrl! }} accessibilityLabel={coverPhoto.altText || coverPhoto.caption || ''} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        </View>
      ) : null}
      <View style={{ width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 24, paddingTop: coverPhoto ? 36 : 64, paddingBottom: 72 }}>
        <Text style={{ fontFamily: displayFont, fontSize: 40, lineHeight: 46, color: '#152944', marginBottom: blog.subtitle ? 8 : 20 }}>
          {blog.title || 'A trip'}
        </Text>
        {blog.subtitle ? (
          <Text style={{ fontFamily: displayFontItalic, fontSize: 18, color: '#6B7280', marginBottom: 20 }}>{blog.subtitle}</Text>
        ) : null}
        {blog.introduction ? (
          <Text style={{ fontFamily: bodyDisplayFont, fontSize: 18, lineHeight: 30, color: '#111827', marginBottom: 40 }}>{blog.introduction}</Text>
        ) : null}

        {daysWithContent.map((day) => (
          <View key={day.localDate} style={{ marginTop: 40, paddingTop: 40, borderTopWidth: 1, borderTopColor: '#E1E8EC' }}>
            <Text style={{ fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', color: '#2E96A6', marginBottom: 6 }}>
              {formatDateLong(day.localDate)}
            </Text>
            {day.headline ? (
              <Text style={{ fontFamily: displayFont, fontSize: 26, color: '#152944', marginBottom: day.summary ? 6 : 16 }}>{day.headline}</Text>
            ) : null}
            {day.summary ? (
              <Text style={{ color: '#6B7280', fontSize: 15, marginBottom: 16 }}>{day.summary}</Text>
            ) : null}
            {day.items.map((item) => {
              if (item.kindKey === 'core.text') {
                const text = stripHtml(item.body || '');
                if (!text) return null;
                return (
                  <Text key={item.id} style={{ fontSize: 17, lineHeight: 28, color: '#111827', marginBottom: 16 }}>{text}</Text>
                );
              }
              if (item.mediaKind === 'photo' && item.primaryUrl) {
                return (
                  <View key={item.id} style={{ marginBottom: 20 }}>
                    <Image
                      source={{ uri: item.primaryUrl }}
                      accessibilityLabel={item.altText || item.caption || 'Trip photo'}
                      style={{ width: '100%', aspectRatio: 3 / 2, borderRadius: 10, backgroundColor: '#F2F5F7' }}
                      resizeMode="cover"
                    />
                    {item.caption ? (
                      <Text style={{ color: '#6B7280', fontSize: 13, marginTop: 6, fontStyle: 'italic' }}>{item.caption}</Text>
                    ) : null}
                  </View>
                );
              }
              if (item.mediaKind === 'video' && item.primaryUrl && Platform.OS === 'web') {
                return (
                  <View key={item.id} style={{ marginBottom: 20 }}>
                    {React.createElement('video', {
                      src: item.primaryUrl,
                      controls: true,
                      style: { width: '100%', borderRadius: 10, display: 'block', backgroundColor: '#000' },
                    })}
                    {item.caption ? (
                      <Text style={{ color: '#6B7280', fontSize: 13, marginTop: 6, fontStyle: 'italic' }}>{item.caption}</Text>
                    ) : null}
                  </View>
                );
              }
              return null;
            })}
            <DayEngagementFooter
              data={engagement[day.localDate]}
              bodyFont={bodyDisplayFont}
              backendUrl={backendUrl}
              username={username}
              tripSlug={tripSlug}
              localDate={day.localDate}
            />
          </View>
        ))}

        {!daysWithContent.length ? (
          <Text style={{ color: '#6B7280', fontSize: 15, marginTop: 20 }}>This trip's story hasn't been shared publicly yet.</Text>
        ) : null}

        <View style={{ marginTop: 64, paddingTop: 24, borderTopWidth: 1, borderTopColor: '#E1E8EC', alignItems: 'center' }}>
          <Text style={{ color: '#94A0AC', fontSize: 12 }}>Told with WanderBunnies</Text>
        </View>
      </View>
    </View>
  );
};

export default PublicTripBlogPage;
