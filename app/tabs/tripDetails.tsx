import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { formatDateLong } from '../utils/formatDateLong';
import { renderRichTextBlocks } from '../utils/richText';
import { formatMonthYear } from '../utils/tripDates';

type Trip = {
  id: string;
  groupId: string;
  name: string;
  description?: string | null;
  destination?: string | null;
  locationIds?: string[];
  startDate?: string | null;
  endDate?: string | null;
  startMonth?: number | null;
  startYear?: number | null;
  durationDays?: number | null;
  currency?: string | null;
  createdAt: string;
};

type GroupView = {
  id: string;
  name: string;
  members: Array<{ id: string; userEmail?: string; email?: string; guestName?: string }>;
  invites: Array<{ id: string; inviteeEmail: string; status: string }>;
};

type ShareInvite = {
  id: string;
  tripId: string;
  inviteeEmail: string;
  role: 'member' | 'follower';
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  createdAt: string;
  token?: string | null;
  autoApplied?: boolean;
};

type TripDetailsTabProps = {
  backendUrl?: string;
  headers?: Record<string, string>;
  trip: Trip | null;
  group: GroupView | null;
  styles: Record<string, any>;
  openShareSignal?: number;
  onSetActive: (tripId: string) => void;
  onOpenItinerary: (tripId: string) => void;
  onUpdateCurrency: (tripId: string, currency: string) => void;
};

const TripDetailsTab: React.FC<TripDetailsTabProps> = ({
  backendUrl,
  headers,
  trip,
  group,
  styles,
  openShareSignal,
  onSetActive,
  onOpenItinerary,
  onUpdateCurrency,
}) => {
  if (!trip) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Trip Details</Text>
        <Text style={styles.helperText}>This trip is no longer available.</Text>
      </View>
    );
  }

  const [showCurrencyDropdown, setShowCurrencyDropdown] = useState(false);
  const [comments, setComments] = useState<Array<{ id: string; body: string; createdAt: string; authorName?: string | null; authorEmail?: string | null }>>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentError, setCommentError] = useState('');
  const currencyOptions = useMemo(
    () => ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'MXN'],
    []
  );
  const currentCurrency = trip.currency ?? 'USD';

  const dateRange = trip.startDate || trip.endDate
    ? `${trip.startDate ? formatDateLong(trip.startDate) : 'Start'} - ${trip.endDate ? formatDateLong(trip.endDate) : 'End'}`
    : null;
  const monthLabel = formatMonthYear(trip.startMonth ?? null, trip.startYear ?? null);
  const pendingInvites = group?.invites ?? [];
  const members = group?.members ?? [];
  const [locationNames, setLocationNames] = useState<string[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareInviteRows, setShareInviteRows] = useState<ShareInvite[]>([]);
  const [followCode, setFollowCode] = useState('');
  const [copyFeedback, setCopyFeedback] = useState('');
  const [inviteInput, setInviteInput] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'follower'>('follower');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteFeedback, setInviteFeedback] = useState('');
  const previousOpenShareSignalRef = useRef<number | undefined>(openShareSignal);

  useEffect(() => {
    const ids = Array.isArray(trip?.locationIds) ? trip!.locationIds : [];
    if (!ids.length) {
      setLocationNames([]);
      return;
    }
    if (!backendUrl || !headers) {
      setLocationNames([]);
      return;
    }
    let active = true;
    fetch(`${backendUrl}/api/places/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ ids }),
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!active) return;
        const names = Array.isArray(data) ? data.map((item: any) => String(item?.name ?? '')).filter(Boolean) : [];
        setLocationNames(names);
      })
      .catch(() => {
        if (active) setLocationNames([]);
      });
    return () => {
      active = false;
    };
  }, [backendUrl, headers, trip?.id, trip?.locationIds]);

  useEffect(() => {
    if (!backendUrl || !headers || !trip?.id) {
      setComments([]);
      return;
    }
    let active = true;
    fetch(`${backendUrl}/api/trips/${trip.id}/comments`, { headers })
      .then((res) => (res.ok ? res.json() : { comments: [] }))
      .then((payload) => {
        if (!active) return;
        setComments(Array.isArray(payload?.comments) ? payload.comments : []);
      })
      .catch(() => {
        if (active) setComments([]);
      });
    return () => {
      active = false;
    };
  }, [backendUrl, headers, trip?.id]);

  const postComment = async () => {
    if (!backendUrl || !headers || !trip?.id) return;
    const body = commentDraft.trim();
    if (!body) return;
    setCommentLoading(true);
    setCommentError('');
    try {
      const res = await fetch(`${backendUrl}/api/trips/${trip.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCommentError(data.error || 'Unable to post comment');
        return;
      }
      setComments((prev) => [...prev, data]);
      setCommentDraft('');
    } catch (err) {
      setCommentError((err as Error).message || 'Unable to post comment');
    } finally {
      setCommentLoading(false);
    }
  };

  const shareLink = useMemo(() => {
    if (!followCode) return '';
    if (typeof window !== 'undefined') {
      const origin = window.location.origin || '';
      return `${origin}/app?followCode=${encodeURIComponent(followCode)}`;
    }
    return followCode;
  }, [followCode]);

  const loadShareData = async () => {
    if (!backendUrl || !headers || !trip?.id) return;
    setShareLoading(true);
    setShareError('');
    try {
      const readJson = async (res: Response): Promise<any> => {
        const text = await res.text().catch(() => '');
        try {
          return text ? JSON.parse(text) : {};
        } catch {
          return {};
        }
      };

      const metaRes = await fetch(`${backendUrl}/api/trips/${trip.id}/share/meta`, { headers });
      const metaData = await readJson(metaRes);

      if (metaRes.ok) {
        const code =
          String(
            metaData.followCode ??
            metaData.inviteCode ??
            metaData.code ??
            ''
          ).trim();
        setFollowCode(code);
        setShareInviteRows(Array.isArray(metaData.invites) ? metaData.invites : []);
        if (!code) {
          setShareError('Share code unavailable for this trip.');
        }
        return;
      }

      // Backward-compatible fallback for servers that only expose follow-code.
      const followCodeRes = await fetch(`${backendUrl}/api/trips/${trip.id}/follow-code`, { headers });
      const followCodeData = await readJson(followCodeRes);
      if (!followCodeRes.ok) {
        setShareError(metaData.error || followCodeData.error || 'Unable to load share link');
        return;
      }

      const fallbackCode =
        String(
          followCodeData.inviteCode ??
          followCodeData.followCode ??
          followCodeData.code ??
          ''
        ).trim();
      setFollowCode(fallbackCode);
      setShareInviteRows([]);
      if (!fallbackCode) {
        setShareError('Share code unavailable for this trip.');
      }
    } catch (err) {
      setShareError((err as Error).message || 'Unable to load share data');
    } finally {
      setShareLoading(false);
    }
  };

  const openShareModal = async () => {
    setShareOpen(true);
    setCopyFeedback('');
    setInviteFeedback('');
    await loadShareData();
  };

  useEffect(() => {
    if (openShareSignal == null) return;
    if (previousOpenShareSignalRef.current === openShareSignal) return;
    previousOpenShareSignalRef.current = openShareSignal;
    openShareModal();
  }, [openShareSignal]);

  const copyShareLink = async () => {
    if (!shareLink) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareLink);
        setCopyFeedback('Link copied.');
        return;
      }
      setCopyFeedback('Clipboard unavailable. Copy manually.');
    } catch {
      setCopyFeedback('Unable to copy link.');
    }
  };

  const parseEmails = (raw: string): string[] => {
    const emails = raw
      .split(/[,\n;]/g)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    return Array.from(new Set(emails));
  };

  const sendInvites = async () => {
    if (!backendUrl || !headers || !trip?.id) return;
    const emails = parseEmails(inviteInput);
    if (!emails.length) {
      setInviteFeedback('Enter at least one email.');
      return;
    }
    const invalid = emails.find((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    if (invalid) {
      setInviteFeedback(`Invalid email: ${invalid}`);
      return;
    }

    setInviteSubmitting(true);
    setInviteFeedback('');
    try {
      const res = await fetch(`${backendUrl}/api/trips/${trip.id}/share/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          invites: emails.map((email) => ({ email, role: inviteRole })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteFeedback(data.error || 'Unable to send invites');
        return;
      }
      const created = Array.isArray(data?.invites) ? data.invites.length : emails.length;
      setInviteFeedback(`Processed ${created} invite(s).`);
      setInviteInput('');
      await loadShareData();
    } catch (err) {
      setInviteFeedback((err as Error).message || 'Unable to send invites');
    } finally {
      setInviteSubmitting(false);
    }
  };

  const revokeInvite = async (inviteId: string) => {
    if (!backendUrl || !headers || !trip?.id) return;
    try {
      const res = await fetch(`${backendUrl}/api/trips/${trip.id}/share/invites/${inviteId}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setInviteFeedback(data.error || 'Unable to revoke invite');
        return;
      }
      setShareInviteRows((prev) => prev.filter((invite) => invite.id !== inviteId));
    } catch (err) {
      setInviteFeedback((err as Error).message || 'Unable to revoke invite');
    }
  };

  return (
    <ScrollView style={styles.card} contentContainerStyle={{ gap: 12 }}>
      <View style={styles.row}>
        <Text style={styles.sectionTitle}>Trip Details</Text>
      </View>
      <Text style={styles.flightTitle}>{trip.name}</Text>
      <Text style={styles.helperText}>Created: {formatDateLong(trip.createdAt)}</Text>
      {locationNames.length ? <Text style={styles.helperText}>Locations: {locationNames.join(', ')}</Text> : null}
      {dateRange ? <Text style={styles.helperText}>Dates: {dateRange}</Text> : null}
      {!dateRange && monthLabel && trip.durationDays ? (
        <Text style={styles.helperText}>
          Dates: {monthLabel} · {trip.durationDays} day(s)
        </Text>
      ) : null}
      {trip.description ? (
        <View style={{ marginTop: 8 }}>
          {renderRichTextBlocks(trip.description, {
            base: styles.bodyText,
            bold: styles.headerText,
            italic: styles.helperText,
            link: styles.linkText ?? styles.buttonText,
            listItem: styles.helperText,
          })}
        </View>
      ) : (
        <Text style={styles.helperText}>No description yet.</Text>
      )}

      <View style={styles.divider} />
      <Text style={styles.headerText}>Currency</Text>
      <View style={[styles.input, styles.dropdown, { marginTop: 6 }]}>
        <TouchableOpacity style={styles.selectButtonRow} onPress={() => setShowCurrencyDropdown((prev) => !prev)}>
          <Text style={styles.cellText}>{currentCurrency}</Text>
          <Text style={styles.selectCaret}>▾</Text>
        </TouchableOpacity>
        {showCurrencyDropdown ? (
          <View style={styles.dropdownList}>
            {currencyOptions.map((currency) => (
              <TouchableOpacity
                key={currency}
                style={styles.dropdownOption}
                onPress={() => {
                  setShowCurrencyDropdown(false);
                  if (currency !== currentCurrency) {
                    onUpdateCurrency(trip.id, currency);
                  }
                }}
              >
                <Text style={styles.cellText}>{currency}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.divider} />
      <Text style={styles.headerText}>Discussion ({comments.length})</Text>
      {comments.length ? (
        comments.map((comment) => (
          <View key={comment.id} style={{ marginTop: 6 }}>
            <Text style={[styles.bodyText, { fontWeight: '700' }]}>{comment.authorName || comment.authorEmail || 'Traveler'}</Text>
            <Text style={styles.bodyText}>{comment.body}</Text>
            <Text style={styles.helperText}>{comment.createdAt ? new Date(comment.createdAt).toLocaleString() : ''}</Text>
          </View>
        ))
      ) : (
        <Text style={styles.helperText}>No comments yet. Start the discussion.</Text>
      )}
      <TextInput
        style={[styles.input, { marginTop: 8, minHeight: 70, textAlignVertical: 'top' }]}
        placeholder="Write a comment..."
        multiline
        value={commentDraft}
        onChangeText={setCommentDraft}
      />
      {commentError ? <Text style={styles.errorText}>{commentError}</Text> : null}
      <TouchableOpacity style={[styles.button, { marginTop: 6 }]} onPress={postComment} disabled={commentLoading || !commentDraft.trim()}>
        <Text style={styles.buttonText}>{commentLoading ? 'Posting...' : 'Post Comment'}</Text>
      </TouchableOpacity>

      <View style={styles.divider} />
      <Text style={styles.headerText}>Participants</Text>
      {members.length ? (
        members.map((m) => (
          <Text key={m.id} style={styles.bodyText}>
            {m.userEmail ?? m.email ?? m.guestName ?? 'Traveler'}
          </Text>
        ))
      ) : (
        <Text style={styles.helperText}>No members listed yet.</Text>
      )}

      <View style={styles.divider} />
      <Text style={styles.headerText}>Pending Invites</Text>
      {pendingInvites.length ? (
        pendingInvites.map((inv) => (
          <Text key={inv.id} style={styles.bodyText}>
            {inv.inviteeEmail} (Pending)
          </Text>
        ))
      ) : (
        <Text style={styles.helperText}>No pending invites.</Text>
      )}

      <View style={styles.row}>
        <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={openShareModal}>
          <Text style={styles.buttonText}>Share</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.row}>
        <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={() => onSetActive(trip.id)}>
          <Text style={styles.buttonText}>Set Active Trip</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={() => onOpenItinerary(trip.id)}>
          <Text style={styles.buttonText}>Open Itinerary</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={shareOpen} transparent animationType="fade" onRequestClose={() => setShareOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, styles.detailModal]}>
            <View style={[styles.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
              <Text style={styles.sectionTitle}>Share Trip</Text>
              <TouchableOpacity onPress={() => setShareOpen(false)}>
                <Text style={styles.linkText ?? styles.buttonText}>Close</Text>
              </TouchableOpacity>
            </View>

            {shareError ? <Text style={styles.errorText}>{shareError}</Text> : null}
            {shareLoading ? <Text style={styles.helperText}>Loading share settings...</Text> : null}

            <Text style={styles.modalLabel}>Share link (Follower access)</Text>
            <TextInput style={styles.input} value={shareLink} editable={false} placeholder="Generating link..." />
            <View style={styles.row}>
              <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={copyShareLink} disabled={!shareLink}>
                <Text style={styles.buttonText}>Copy Link</Text>
              </TouchableOpacity>
              <Text style={styles.helperText}>Link grants follower (view-only) access.</Text>
            </View>
            {copyFeedback ? <Text style={styles.helperText}>{copyFeedback}</Text> : null}

            <View style={styles.divider} />
            <Text style={styles.modalLabel}>Invite by email</Text>
            <TextInput
              style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]}
              multiline
              placeholder="Enter one or more emails (comma or new line separated)"
              value={inviteInput}
              onChangeText={setInviteInput}
            />
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.button, styles.smallButton, inviteRole === 'follower' ? undefined : styles.buttonDisabled]}
                onPress={() => setInviteRole('follower')}
              >
                <Text style={styles.buttonText}>Follower</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.smallButton, inviteRole === 'member' ? undefined : styles.buttonDisabled]}
                onPress={() => setInviteRole('member')}
              >
                <Text style={styles.buttonText}>Member</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.smallButton, inviteSubmitting && styles.buttonDisabled]}
                onPress={sendInvites}
                disabled={inviteSubmitting}
              >
                <Text style={styles.buttonText}>{inviteSubmitting ? 'Sending...' : 'Send Invite'}</Text>
              </TouchableOpacity>
            </View>
            {inviteFeedback ? <Text style={styles.helperText}>{inviteFeedback}</Text> : null}

            <View style={styles.divider} />
            <Text style={styles.modalLabel}>Recent invites</Text>
            <ScrollView style={{ maxHeight: 180 }}>
              {(shareInviteRows ?? []).length ? (
                shareInviteRows.map((invite) => (
                  <View key={invite.id} style={[styles.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                    <Text style={styles.bodyText}>
                      {invite.inviteeEmail} · {invite.role} · {invite.status}
                    </Text>
                    {invite.status === 'pending' ? (
                      <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => revokeInvite(invite.id)}>
                        <Text style={styles.buttonText}>Revoke</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ))
              ) : (
                <Text style={styles.helperText}>No invites yet.</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

export default TripDetailsTab;
