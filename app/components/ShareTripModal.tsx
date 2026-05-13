import React, { useMemo, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

type Trip = {
  id: string;
  name: string;
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

type ShareTripModalProps = {
  visible: boolean;
  backendUrl?: string;
  headers?: Record<string, string>;
  trip: Trip | null;
  styles: Record<string, any>;
  onClose: () => void;
};

const ShareTripModal: React.FC<ShareTripModalProps> = ({
  visible,
  backendUrl,
  headers,
  trip,
  styles,
  onClose,
}) => {
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareInviteRows, setShareInviteRows] = useState<ShareInvite[]>([]);
  const [followCode, setFollowCode] = useState('');
  const [copyFeedback, setCopyFeedback] = useState('');
  const [inviteInput, setInviteInput] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'follower'>('follower');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteFeedback, setInviteFeedback] = useState('');

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
        const code = String(metaData.followCode ?? metaData.inviteCode ?? metaData.code ?? '').trim();
        setFollowCode(code);
        setShareInviteRows(Array.isArray(metaData.invites) ? metaData.invites : []);
        if (!code) setShareError('Share code unavailable for this trip.');
        return;
      }

      const followCodeRes = await fetch(`${backendUrl}/api/trips/${trip.id}/follow-code`, { headers });
      const followCodeData = await readJson(followCodeRes);
      if (!followCodeRes.ok) {
        setShareError(metaData.error || followCodeData.error || 'Unable to load share link');
        return;
      }

      const fallbackCode = String(followCodeData.inviteCode ?? followCodeData.followCode ?? followCodeData.code ?? '').trim();
      setFollowCode(fallbackCode);
      setShareInviteRows([]);
      if (!fallbackCode) setShareError('Share code unavailable for this trip.');
    } catch (err) {
      setShareError((err as Error).message || 'Unable to load share data');
    } finally {
      setShareLoading(false);
    }
  };

  React.useEffect(() => {
    if (!visible) return;
    setCopyFeedback('');
    setInviteFeedback('');
    void loadShareData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, trip?.id]);

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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, styles.detailModal]}>
          <View style={[styles.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
            <Text style={styles.sectionTitle}>Share Trip</Text>
            <TouchableOpacity onPress={onClose}>
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
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            keyboardType="email-address"
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
                      <Text style={styles.dangerButtonText}>Revoke</Text>
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
  );
};

export default ShareTripModal;
