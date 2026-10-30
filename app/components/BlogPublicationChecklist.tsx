import IconText from './IconText';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

export type BlogPublicationReadiness = {
  state: string;
  optedOut: boolean;
  tripStarted: boolean;
  goLiveDate: string | null;
  missingBirthDate: number;
  selfMissingBirthDate: boolean;
  underAge: number;
  privateDefaultCount: number;
  altTextIssueCount: number;
  ready: boolean;
};

type Props = {
  tripId: string;
  backendUrl: string;
  headers: Record<string, string>;
  /** Bump to re-check, for example after the blog or the publication status changes. */
  refreshKey?: unknown;
  styles: Record<string, any>;
};

type Line = { key: string; ok: boolean; text: string };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What stands between this blog and going public, in the order a traveler can fix it. */
export const readinessLines = (r: BlogPublicationReadiness): Line[] => [
  {
    key: 'start',
    ok: r.tripStarted,
    text: r.tripStarted ? 'The trip has started, so the blog can be public.' : `The blog goes public when the trip starts${r.goLiveDate ? ` on ${r.goLiveDate}` : ''}.`,
  },
  {
    key: 'optout',
    ok: !r.optedOut,
    text: r.optedOut ? 'A traveler made the blog private. Allow public viewing to continue.' : 'No traveler has made the blog private.',
  },
  {
    key: 'dob',
    ok: r.missingBirthDate === 0,
    text: r.missingBirthDate === 0
      ? 'Every traveler has a date of birth.'
      : r.selfMissingBirthDate
        ? `Add your date of birth in your profile (${plural(r.missingBirthDate, 'traveler is', 'travelers are')} missing one).`
        : `${plural(r.missingBirthDate, 'traveler is', 'travelers are')} missing a date of birth in their profile.`,
  },
  {
    key: 'age',
    ok: r.underAge === 0,
    text: r.underAge === 0 ? 'Every account traveler is 16 or older.' : `${plural(r.underAge, 'account traveler is', 'account travelers are')} under 16, which keeps the blog off the public web.`,
  },
  {
    key: 'default',
    ok: r.privateDefaultCount === 0,
    text: r.privateDefaultCount === 0 ? 'No traveler keeps their blogs private by default.' : `${plural(r.privateDefaultCount, 'traveler keeps', 'travelers keep')} their blogs private by default in their profile.`,
  },
  {
    key: 'alt',
    ok: r.altTextIssueCount === 0,
    text: r.altTextIssueCount === 0 ? 'Every public photo has alt text.' : `${plural(r.altTextIssueCount, 'public photo needs', 'public photos need')} alt text or a decorative mark.`,
  },
];

const BlogPublicationChecklist: React.FC<Props> = ({ tripId, backendUrl, headers, refreshKey, styles }) => {
  const [readiness, setReadiness] = useState<BlogPublicationReadiness | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${backendUrl}/api/trips/${tripId}/blog/publication/readiness`, { headers });
        if (!response.ok) return;
        const body = await response.json();
        if (!cancelled) setReadiness(body);
      } catch {
        // The checklist is supplementary; the publish controls still work without it.
      }
    })();
    return () => { cancelled = true; };
    // headers is rebuilt on every render of the caller; the trip and refreshKey decide when to re-check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, backendUrl, refreshKey]);

  if (!readiness) return null;
  return (
    <View testID="blog-publication-checklist">
      <Text style={styles.sectionTitle}>{readiness.ready && readiness.tripStarted ? 'Ready to go public' : 'Before this blog goes public'}</Text>
      {readinessLines(readiness).map((line) => (
        <IconText key={line.key} testID={`blog-publication-check-${line.key}`} style={styles.helperText} accessibilityLabel={`${line.ok ? 'Done' : 'To do'}: ${line.text}`}>
          {line.ok ? '☑' : '☐'} {line.text}
        </IconText>
      ))}
    </View>
  );
};

export default BlogPublicationChecklist;
