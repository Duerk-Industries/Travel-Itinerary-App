import { screenFetch as fetch } from '../cache/screenFetch';
import IconText from './IconText';
import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

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
  earlyRelease?: boolean;
  selfOptedOut?: boolean;
  selfPrivateDefault?: boolean;
  selfOptedIn?: boolean;
  optedOutTravelers?: Array<{ firstName: string }>;
  reasons?: string[];
};

type Props = {
  tripId: string;
  backendUrl: string;
  headers: Record<string, string>;
  /** Bump to re-check, for example after the blog or the publication status changes. */
  refreshKey?: unknown;
  styles: Record<string, any>;
  onChanged?: () => void | Promise<void>;
};

type Line = { key: string; ok: boolean; text: string };

export const readinessLines = (r: BlogPublicationReadiness): Line[] => [
  { key: 'start', ok: r.tripStarted || r.earlyRelease === true,
    text: r.earlyRelease ? 'Released early for public viewing' : `${r.tripStarted ? 'Public since' : 'Goes public on'} ${r.goLiveDate || 'the trip start date (not set)'}` },
  { key: 'age', ok: r.underAge === 0 && r.missingBirthDate === 0,
    text: `No account traveler is under 16${r.underAge ? ` — ${r.underAge} ${r.underAge === 1 ? 'is' : 'are'} under 16` : ''}${r.missingBirthDate ? ` — ${r.missingBirthDate} missing ${r.missingBirthDate === 1 ? 'date' : 'dates'} of birth${r.selfMissingBirthDate ? '; add yours in your profile' : ''}` : ''}` },
  { key: 'optout', ok: !r.optedOut,
    text: `No traveler has opted out${r.optedOutTravelers?.length ? ` — opted out: ${r.optedOutTravelers.map(m => m.firstName).join(', ')}` : ''}` },
];

const BlogPublicationChecklist: React.FC<Props> = ({ tripId, backendUrl, headers, refreshKey, styles, onChanged }) => {
  const [readiness, setReadiness] = useState<BlogPublicationReadiness | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changePrivacy = async (choice: { optOut?: boolean; optIn?: boolean } | 'release') => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${backendUrl}/api/trips/${tripId}/blog/publication/${choice === 'release' ? 'request' : 'privacy'}`, {
        method: choice === 'release' ? 'POST' : 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
        ...(choice === 'release' ? {} : { body: JSON.stringify(choice) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to update public viewing');
      const next = await fetch(`${backendUrl}/api/trips/${tripId}/blog/publication/readiness`, { headers });
      if (next.ok) setReadiness(await next.json());
      await onChanged?.();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    let cancelled = false;
    setReadiness(null);
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
      <Text style={styles.sectionTitle}>{readiness.state === 'public' ? 'Public viewing is on' : 'Before this blog goes public'}</Text>
      {readinessLines(readiness).map((line) => (
        <IconText key={line.key} testID={`blog-publication-check-${line.key}`} style={styles.helperText} accessibilityLabel={`${line.ok ? 'Done' : 'To do'}: ${line.text}`}>
          {line.ok ? '☑' : '☐'} {line.text}
        </IconText>
      ))}
      <Text testID="blog-publication-alt-reminder" style={styles.helperText}>
        Optional: {readiness.altTextIssueCount ? `${readiness.altTextIssueCount} public photos need alt text or a decorative mark.` : 'Add alt text to help everyone enjoy your photos.'}
      </Text>
      <View style={styles.row}>
        <TouchableOpacity testID={readiness.selfOptedOut ? 'blog-allow-public' : 'blog-make-private'} accessibilityRole="button"
          style={styles.button} disabled={busy} onPress={() => changePrivacy({ optOut: !readiness.selfOptedOut })}>
          <Text style={styles.buttonText}>{readiness.selfOptedOut ? 'Remove my opt-out' : 'Make private'}</Text>
        </TouchableOpacity>
        {readiness.selfPrivateDefault ? <TouchableOpacity testID="blog-trip-opt-in" accessibilityRole="switch"
          accessibilityLabel="Allow this trip’s blog to be public" accessibilityState={{ checked: readiness.selfOptedIn === true, disabled: busy }}
          style={styles.button} disabled={busy} onPress={() => changePrivacy({ optIn: !readiness.selfOptedIn })}>
          <Text style={styles.buttonText}>{readiness.selfOptedIn ? 'Stop allowing this trip’s blog to be public' : 'Allow this trip’s blog to be public'}</Text>
        </TouchableOpacity> : null}
        {readiness.state !== 'public' ? <TouchableOpacity testID="blog-make-public-now" accessibilityRole="button"
          style={styles.button} disabled={busy || !readiness.ready} onPress={() => changePrivacy('release')}>
          <Text style={styles.buttonText}>{busy ? 'Updating…' : 'Make public now'}</Text>
        </TouchableOpacity> : null}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.helperText}>{error}</Text> : null}
    </View>
  );
};

export default BlogPublicationChecklist;
