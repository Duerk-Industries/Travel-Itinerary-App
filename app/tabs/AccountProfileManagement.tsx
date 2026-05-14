import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DropdownOptionButton from '../components/DropdownOptionButton';
import ConfirmDialog from '../components/ConfirmDialog';
import DialogShell from '../components/DialogShell';
import DraftTextInput from '../components/DraftTextInput';
import { type MapApp, isMapApp, mapAppOptions } from '../utils/mapLinks';
import { appearanceOptions, isAppearancePreference, type AppearancePreference } from '../utils/appearancePreference';
import { normalizeTemperatureUnit, type TemperatureUnit } from '../utils/temperatureUnit';
import { AccountProfile } from './account';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;
type Styles = ReturnType<typeof StyleSheet.create>;
type Headers = Record<string, string>;
type AddressForm = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

const emptyAddressForm = (): AddressForm => ({
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
});

const fallbackAirportOptions = [
  'Atlanta (ATL)',
  'Boston (BOS)',
  'Chicago (ORD)',
  'Dallas-Fort Worth (DFW)',
  'Denver (DEN)',
  'Los Angeles (LAX)',
  'New York (JFK)',
  'Newark (EWR)',
  'San Francisco (SFO)',
  'Seattle (SEA)',
];

const parseStatePostal = (value: string): { state: string; postalCode: string } => {
  const trimmed = value.trim();
  if (!trimmed) return { state: '', postalCode: '' };
  const match = trimmed.match(/^(.*?)(?:\s+([A-Za-z0-9-]{3,12}))?$/);
  return {
    state: match?.[1]?.trim() ?? '',
    postalCode: match?.[2]?.trim() ?? '',
  };
};

const parseHomeAddress = (value: string | null | undefined): AddressForm => {
  const input = String(value ?? '').trim();
  if (!input) return emptyAddressForm();
  const parts = input.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 5) {
    const [line1 = '', line2 = '', city = '', statePostal = '', country = ''] = parts;
    const { state, postalCode } = parseStatePostal(statePostal);
    return { line1, line2, city, state, postalCode, country };
  }
  if (parts.length === 4) {
    const [line1 = '', city = '', statePostal = '', country = ''] = parts;
    const { state, postalCode } = parseStatePostal(statePostal);
    return { line1, line2: '', city, state, postalCode, country };
  }
  if (parts.length === 3) {
    const [line1 = '', city = '', statePostal = ''] = parts;
    const { state, postalCode } = parseStatePostal(statePostal);
    return { line1, line2: '', city, state, postalCode, country: '' };
  }
  if (parts.length === 2) {
    const [line1 = '', city = ''] = parts;
    return { line1, line2: '', city, state: '', postalCode: '', country: '' };
  }
  return { line1: parts[0] ?? '', line2: '', city: '', state: '', postalCode: '', country: '' };
};

const formatHomeAddress = (address: AddressForm): string =>
  [
    address.line1.trim(),
    address.line2.trim(),
    address.city.trim(),
    [address.state.trim(), address.postalCode.trim()].filter(Boolean).join(' ').trim(),
    address.country.trim(),
  ]
    .filter(Boolean)
    .join(', ');

const temperatureUnitOptions: Array<{ key: TemperatureUnit; label: string }> = [
  { key: 'fahrenheit', label: 'Fahrenheit' },
  { key: 'celsius', label: 'Celsius' },
];

interface AccountProfileManagementProps {
  backendUrl: string;
  userToken: string | null;
  activePage: string;
  accountProfile: AccountProfile;
  setAccountProfile: Setter<AccountProfile>;
  setUserToken: Setter<string | null>;
  setUserName: Setter<string | null>;
  setUserEmail: Setter<string | null>;
  mapApp: MapApp;
  onChangeMapApp: (pref: MapApp) => void;
  appearancePreference: AppearancePreference;
  onChangeAppearancePreference: (pref: AppearancePreference) => void;
  saveSession: (token: string, name: string, page?: string, email?: string | null) => void;
  headers: Headers;
  jsonHeaders: Headers;
  airportOptions: string[];
  onSearchAirports: (q: string) => Promise<void> | void;
  logout: () => void;
  styles: Styles;
}

const AccountProfileManagement = ({
  backendUrl,
  userToken,
  activePage,
  accountProfile,
  setAccountProfile,
  setUserToken,
  setUserName,
  setUserEmail,
  mapApp,
  onChangeMapApp,
  appearancePreference,
  onChangeAppearancePreference,
  saveSession,
  headers,
  jsonHeaders,
  airportOptions,
  onSearchAirports,
  logout,
  styles,
}: AccountProfileManagementProps) => {
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    newPasswordConfirm: '',
  });
  const [showPasswordEditor, setShowPasswordEditor] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAddressEditor, setShowAddressEditor] = useState(false);
  const [addressForm, setAddressForm] = useState<AddressForm>(() => parseHomeAddress(accountProfile.homeAddress));
  const [preferredAirportSuggestions, setPreferredAirportSuggestions] = useState<string[]>([]);
  const [showPreferredAirportSuggestions, setShowPreferredAirportSuggestions] = useState(false);
  const [multiEmailEnabled, setMultiEmailEnabled] = useState(false);
  const [emailManagerLoaded, setEmailManagerLoaded] = useState(false);
  const [accountEmails, setAccountEmails] = useState<Array<{ email: string; isPrimary: boolean; isVerified: boolean }>>([]);
  const [newEmail, setNewEmail] = useState('');
  const [emailActionBusy, setEmailActionBusy] = useState(false);

  const parsePreferredAirportCode = (value: string): string => {
    const input = String(value ?? '').trim();
    if (!input) return '';
    const codeMatch = input.match(/\(([A-Za-z0-9]{3,4})\)/);
    if (codeMatch?.[1]) return codeMatch[1].toUpperCase();
    if (/^[A-Za-z0-9]{3,4}$/.test(input)) return input.toUpperCase();
    const token = input.match(/\b([A-Za-z0-9]{3,4})\b/);
    return token?.[1]?.toUpperCase() ?? input;
  };

  const buildAirportSuggestions = (query: string): string[] => {
    const trimmed = query.trim();
    const sourceOptions = airportOptions.length ? airportOptions : fallbackAirportOptions;
    if (!trimmed) return sourceOptions.slice(0, 10);
    const lower = trimmed.toLowerCase();
    return sourceOptions
      .filter((opt) => {
        const normalized = opt.toLowerCase();
        const code = parsePreferredAirportCode(opt).toLowerCase();
        return normalized.includes(lower) || code.startsWith(lower);
      })
      .slice(0, 10);
  };

  const handlePreferredAirportChange = (text: string) => {
    setAccountProfile((p) => ({ ...p, preferredAirport: text }));
    const next = buildAirportSuggestions(text);
    setPreferredAirportSuggestions(next);
    setShowPreferredAirportSuggestions(true);
  };

  useEffect(() => {
    if (!showPreferredAirportSuggestions) return;
    setPreferredAirportSuggestions(buildAirportSuggestions(accountProfile.preferredAirport ?? ''));
  }, [airportOptions, accountProfile.preferredAirport, showPreferredAirportSuggestions]);

  useEffect(() => {
    if (!showPreferredAirportSuggestions) return;
    const query = String(accountProfile.preferredAirport ?? '').trim();
    if (query.length < 2) return;
    const handle = setTimeout(() => {
      void onSearchAirports(query);
    }, 150);
    return () => clearTimeout(handle);
  }, [accountProfile.preferredAirport, onSearchAirports, showPreferredAirportSuggestions]);

  useEffect(() => {
    if (!showAddressEditor) {
      setAddressForm(parseHomeAddress(accountProfile.homeAddress));
    }
  }, [accountProfile.homeAddress, showAddressEditor]);

  const formattedHomeAddress = useMemo(() => formatHomeAddress(parseHomeAddress(accountProfile.homeAddress)), [accountProfile.homeAddress]);

  useEffect(() => {
    if (!userToken) return;
    let cancelled = false;
    const loadEmails = async () => {
      try {
        const res = await fetch(`${backendUrl}/api/account/emails`, { headers });
        if (cancelled) return;
        if (res.status === 404) {
          setMultiEmailEnabled(false);
          setEmailManagerLoaded(true);
          return;
        }
        if (!res.ok) {
          setEmailManagerLoaded(true);
          return;
        }
        const data = await res.json().catch(() => ({}));
        setAccountEmails(Array.isArray(data.emails) ? data.emails : []);
        setMultiEmailEnabled(true);
        setEmailManagerLoaded(true);
      } catch {
        if (!cancelled) setEmailManagerLoaded(true);
      }
    };
    loadEmails();
    return () => {
      cancelled = true;
    };
  }, [backendUrl, headers, userToken]);

  const localStyles = StyleSheet.create({
    airportFieldWrap: {
      position: 'relative',
      zIndex: 6,
    },
    airportSuggestionList: {
      marginTop: 4,
      maxHeight: 220,
      overflow: 'hidden',
    },
    airportSuggestionOption: {
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
  });

  const handleProfileUpdate = async () => {
    if (!userToken) return;
    setAccountMessage(null);
    const res = await fetch(`${backendUrl}/api/account/profile`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ ...accountProfile, mapPreference: accountProfile.mapPreference ?? mapApp }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to update profile');
      return;
    }
    const updatedUser = data.user ?? accountProfile;
    const nextMapPreference = isMapApp(updatedUser.mapPreference)
      ? updatedUser.mapPreference
      : accountProfile.mapPreference ?? mapApp;
    const nextAppearancePreference = isAppearancePreference(updatedUser.appearancePreference)
      ? updatedUser.appearancePreference
      : accountProfile.appearancePreference ?? appearancePreference;
    const nextTemperatureUnit = normalizeTemperatureUnit(updatedUser.temperatureUnit, accountProfile.temperatureUnit ?? 'fahrenheit');
    onChangeMapApp(nextMapPreference);
    onChangeAppearancePreference(nextAppearancePreference);
    const fullName = `${updatedUser.firstName ?? ''} ${updatedUser.lastName ?? ''}`.trim() || 'Traveler';
    if (data.token) {
      setUserToken(data.token);
      saveSession(data.token, fullName, activePage, updatedUser.email ?? accountProfile.email);
    }
    setUserName(fullName);
    setUserEmail(updatedUser.email ?? null);
    setAccountProfile({
      firstName: updatedUser.firstName ?? '',
      lastName: updatedUser.lastName ?? '',
      email: updatedUser.email ?? '',
      homeAddress: updatedUser.homeAddress ?? '',
      preferredAirport: updatedUser.preferredAirport ?? '',
      mapPreference: nextMapPreference,
      appearancePreference: nextAppearancePreference,
      temperatureUnit: nextTemperatureUnit,
    });
    setAccountMessage('Profile updated');
  };

  const handlePasswordChange = async () => {
    if (!userToken) return;
    if (passwordForm.newPassword !== passwordForm.newPasswordConfirm) {
      alert('New passwords do not match');
      return;
    }
    setAccountMessage(null);
    const res = await fetch(`${backendUrl}/api/account/password`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(passwordForm),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to update password');
      return;
    }
    setAccountMessage('Password updated');
    setPasswordForm({ currentPassword: '', newPassword: '', newPasswordConfirm: '' });
    setShowPasswordEditor(false);
  };

  const handleDeleteAccount = async () => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/account`, { method: 'DELETE', headers });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to delete account');
      return;
    }
    setShowDeleteConfirm(false);
    logout();
  };

  const refreshAccountEmails = async () => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/account/emails`, { headers });
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    setAccountEmails(Array.isArray(data.emails) ? data.emails : []);
  };

  const handleAddEmail = async () => {
    const candidate = newEmail.trim().toLowerCase();
    if (!candidate) {
      alert('Enter an email address.');
      return;
    }
    try {
      setEmailActionBusy(true);
      const res = await fetch(`${backendUrl}/api/account/emails`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ email: candidate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Unable to add email.');
        return;
      }
      setNewEmail('');
      await refreshAccountEmails();
      alert('Email added. Check your inbox for the verification link.');
    } catch (err) {
      alert((err as Error).message || 'Unable to add email.');
    } finally {
      setEmailActionBusy(false);
    }
  };

  const handleResendEmailVerification = async (email: string) => {
    try {
      setEmailActionBusy(true);
      const res = await fetch(`${backendUrl}/api/account/emails/${encodeURIComponent(email)}/resend-verification`, {
        method: 'POST',
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Unable to resend verification.');
        return;
      }
      alert('Verification email sent.');
    } catch (err) {
      alert((err as Error).message || 'Unable to resend verification.');
    } finally {
      setEmailActionBusy(false);
    }
  };

  const handleSetPrimaryEmail = async (email: string) => {
    try {
      setEmailActionBusy(true);
      const res = await fetch(`${backendUrl}/api/account/emails/primary`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Unable to set primary email.');
        return;
      }
      if (typeof data.token === 'string') {
        const fullName = `${accountProfile.firstName ?? ''} ${accountProfile.lastName ?? ''}`.trim() || 'Traveler';
        setUserToken(data.token);
        saveSession(data.token, fullName, activePage, email);
      }
      setAccountProfile((prev) => ({ ...prev, email }));
      setUserEmail(email);
      if (Array.isArray(data.emails)) {
        setAccountEmails(data.emails);
      } else {
        await refreshAccountEmails();
      }
    } catch (err) {
      alert((err as Error).message || 'Unable to set primary email.');
    } finally {
      setEmailActionBusy(false);
    }
  };

  const handleDeleteSecondaryEmail = async (email: string) => {
    try {
      setEmailActionBusy(true);
      const res = await fetch(`${backendUrl}/api/account/emails/${encodeURIComponent(email)}`, {
        method: 'DELETE',
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Unable to delete email.');
        return;
      }
      if (Array.isArray(data.emails)) {
        setAccountEmails(data.emails);
      } else {
        await refreshAccountEmails();
      }
    } catch (err) {
      alert((err as Error).message || 'Unable to delete email.');
    } finally {
      setEmailActionBusy(false);
    }
  };

  return (
    <View style={[styles.card, styles.accountSection]}>
      <Text style={styles.sectionTitle}>Account</Text>
      <Text style={styles.helperText}>Update your profile, change your password, or remove your account.</Text>
      {accountMessage ? (
        <View style={styles.successCard}>
          <Text style={styles.bodyText}>{accountMessage}</Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <DraftTextInput style={[styles.input, { flex: 1 }]} placeholder="First name" autoComplete="given-name" textContentType="givenName" value={accountProfile.firstName} onChangeText={(text: string) => setAccountProfile((p) => ({ ...p, firstName: text }))} commitOnBlur={false} />
        <DraftTextInput style={[styles.input, { flex: 1 }]} placeholder="Last name" autoComplete="family-name" textContentType="familyName" value={accountProfile.lastName} onChangeText={(text: string) => setAccountProfile((p) => ({ ...p, lastName: text }))} commitOnBlur={false} />
      </View>
      <DraftTextInput style={styles.input} placeholder="Email" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" keyboardType="email-address" value={accountProfile.email} onChangeText={(text: string) => setAccountProfile((p) => ({ ...p, email: text }))} commitOnBlur={false} />
      <TouchableOpacity
        style={[styles.input, { justifyContent: 'center' }]}
        onPress={() => setShowAddressEditor(true)}
      >
        <Text style={formattedHomeAddress ? styles.cellText : styles.placeholderText}>
          {formattedHomeAddress || 'Home address (optional)'}
        </Text>
      </TouchableOpacity>
      <View style={localStyles.airportFieldWrap}>
        <TextInput
          style={styles.input}
          placeholder="Preferred airport (optional)"
          value={accountProfile.preferredAirport ?? ''}
          onFocus={() => {
            setPreferredAirportSuggestions(buildAirportSuggestions(accountProfile.preferredAirport ?? ''));
            setShowPreferredAirportSuggestions(true);
          }}
          onBlur={() => setTimeout(() => setShowPreferredAirportSuggestions(false), 120)}
          onChangeText={handlePreferredAirportChange}
          autoComplete="off"
          autoCorrect={false}
          textContentType="none"
        />
        {showPreferredAirportSuggestions ? (
          <View style={[styles.dropdownList, localStyles.airportSuggestionList]}>
            {preferredAirportSuggestions.length ? (
              preferredAirportSuggestions.map((opt, idx) => (
                <DropdownOptionButton
                  key={opt}
                  styles={styles}
                  style={[
                    localStyles.airportSuggestionOption,
                    idx === preferredAirportSuggestions.length - 1 && { borderBottomWidth: 0 },
                  ]}
                  onPress={() => {
                    setAccountProfile((p) => ({ ...p, preferredAirport: parsePreferredAirportCode(opt) }));
                    setShowPreferredAirportSuggestions(false);
                  }}
                >
                  <Text style={styles.cellText}>{opt}</Text>
                </DropdownOptionButton>
              ))
            ) : (
              <Text style={[styles.helperText, { paddingHorizontal: 12, paddingVertical: 10 }]}>
                Type to search airports
              </Text>
            )}
          </View>
        ) : null}
      </View>
      <Text style={styles.modalLabel}>Preferred maps app</Text>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        {mapAppOptions.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[
              styles.mapOptionButton,
              mapApp === opt.key && styles.mapOptionActive,
              { marginRight: 8, marginTop: 4 },
            ]}
            onPress={() => {
              onChangeMapApp(opt.key);
              setAccountProfile((p) => ({ ...p, mapPreference: opt.key }));
            }}
          >
            <Text style={[styles.mapOptionText, mapApp === opt.key && styles.mapOptionActiveText]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.helperText}>
        Selected: {mapAppOptions.find((opt) => opt.key === mapApp)?.label ?? 'Google Maps'}
      </Text>
      <Text style={styles.modalLabel}>Appearance</Text>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        {appearanceOptions.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[
              styles.mapOptionButton,
              appearancePreference === opt.key && styles.mapOptionActive,
              { marginRight: 8, marginTop: 4 },
            ]}
            onPress={() => {
              onChangeAppearancePreference(opt.key);
              setAccountProfile((p) => ({ ...p, appearancePreference: opt.key }));
            }}
          >
            <Text style={[styles.mapOptionText, appearancePreference === opt.key && styles.mapOptionActiveText]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.helperText}>
        Selected: {appearanceOptions.find((opt) => opt.key === appearancePreference)?.label ?? 'Auto'}
      </Text>
      <Text style={styles.modalLabel}>Temperature</Text>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        {temperatureUnitOptions.map((opt) => {
          const selected = normalizeTemperatureUnit(accountProfile.temperatureUnit) === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[
                styles.mapOptionButton,
                selected && styles.mapOptionActive,
                { marginRight: 8, marginTop: 4 },
              ]}
              onPress={() => {
                setAccountProfile((p) => ({ ...p, temperatureUnit: opt.key }));
              }}
            >
              <Text style={[styles.mapOptionText, selected && styles.mapOptionActiveText]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.helperText}>
        Selected: {temperatureUnitOptions.find((opt) => opt.key === normalizeTemperatureUnit(accountProfile.temperatureUnit))?.label ?? 'Fahrenheit'}
      </Text>
      <TouchableOpacity style={styles.button} onPress={handleProfileUpdate}>
        <Text style={styles.buttonText}>Save Profile</Text>
      </TouchableOpacity>
      {emailManagerLoaded && multiEmailEnabled ? (
        <>
          <View style={styles.divider} />
          <Text style={styles.modalLabel}>Account emails</Text>
          <Text style={styles.helperText}>Add verified emails, choose your primary sign-in email, and remove non-primary emails.</Text>
          {accountEmails.map((entry) => (
            <View key={entry.email} style={[styles.row, { alignItems: 'center', justifyContent: 'space-between' }]}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.cellText}>{entry.email}</Text>
                <Text style={styles.helperText}>
                  {entry.isPrimary ? 'Primary' : 'Secondary'} | {entry.isVerified ? 'Verified' : 'Pending verification'}
                </Text>
              </View>
              {!entry.isPrimary && entry.isVerified ? (
                <TouchableOpacity style={[styles.button, styles.smallButton]} disabled={emailActionBusy} onPress={() => handleSetPrimaryEmail(entry.email)}>
                  <Text style={styles.buttonText}>Make Primary</Text>
                </TouchableOpacity>
              ) : null}
              {!entry.isPrimary ? (
                <TouchableOpacity
                  style={[styles.button, styles.smallButton, styles.dangerButton]}
                  disabled={emailActionBusy}
                  onPress={() => handleDeleteSecondaryEmail(entry.email)}
                >
                  <Text style={styles.dangerButtonText}>Delete</Text>
                </TouchableOpacity>
              ) : null}
              {!entry.isVerified ? (
                <TouchableOpacity style={[styles.button, styles.smallButton]} disabled={emailActionBusy} onPress={() => handleResendEmailVerification(entry.email)}>
                  <Text style={styles.buttonText}>Resend Verify</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
          <View style={styles.row}>
            <DraftTextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Add email"
              autoCapitalize="none"
              keyboardType="email-address"
              value={newEmail}
              onChangeText={setNewEmail}
              commitOnBlur={false}
            />
            <TouchableOpacity style={[styles.button, emailActionBusy && styles.buttonDisabled]} disabled={emailActionBusy} onPress={handleAddEmail}>
              <Text style={styles.buttonText}>Add</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      <View style={styles.divider} />
      {!showPasswordEditor ? (
        <TouchableOpacity style={styles.button} onPress={() => setShowPasswordEditor(true)}>
          <Text style={styles.buttonText}>Change Password</Text>
        </TouchableOpacity>
      ) : (
        <>
          <Text style={styles.modalLabel}>Change password</Text>
          <DraftTextInput style={styles.input} placeholder="Current password" secureTextEntry value={passwordForm.currentPassword} onChangeText={(text: string) => setPasswordForm(p => ({ ...p, currentPassword: text }))} commitOnBlur={false} />
          <DraftTextInput style={styles.input} placeholder="New password" secureTextEntry value={passwordForm.newPassword} onChangeText={(text: string) => setPasswordForm(p => ({ ...p, newPassword: text }))} commitOnBlur={false} />
          <DraftTextInput style={styles.input} placeholder="Confirm new password" secureTextEntry value={passwordForm.newPasswordConfirm} onChangeText={(text: string) => setPasswordForm(p => ({ ...p, newPasswordConfirm: text }))} commitOnBlur={false} />
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.button, styles.dangerButton, { flex: 1 }]}
              onPress={() => {
                setPasswordForm({ currentPassword: '', newPassword: '', newPasswordConfirm: '' });
                setShowPasswordEditor(false);
              }}
            >
              <Text style={styles.dangerButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={handlePasswordChange}>
              <Text style={styles.buttonText}>Update Password</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <View style={styles.divider} />
      <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={() => setShowDeleteConfirm(true)}>
        <Text style={styles.dangerButtonText}>Delete Account</Text>
      </TouchableOpacity>
      <ConfirmDialog
        visible={showDeleteConfirm}
        title="Delete account?"
        message="This cannot be undone. All solo trips and data will be removed."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDeleteAccount}
        onCancel={() => setShowDeleteConfirm(false)}
        styles={styles}
      />
      {showAddressEditor ? (
        <DialogShell
          visible={showAddressEditor}
          title="Home Address"
          styles={styles}
          onClose={() => setShowAddressEditor(false)}
          useNativeModal
        >
              <DraftTextInput
                style={styles.input}
                placeholder="Address line 1"
                value={addressForm.line1}
                onChangeText={(text: string) => setAddressForm((prev) => ({ ...prev, line1: text }))}
                commitOnBlur={false}
              />
              <DraftTextInput
                style={styles.input}
                placeholder="Address line 2"
                value={addressForm.line2}
                onChangeText={(text: string) => setAddressForm((prev) => ({ ...prev, line2: text }))}
                commitOnBlur={false}
              />
              <View style={styles.row}>
                <DraftTextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="City"
                  value={addressForm.city}
                  onChangeText={(text: string) => setAddressForm((prev) => ({ ...prev, city: text }))}
                  commitOnBlur={false}
                />
                <DraftTextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="State / Province"
                  value={addressForm.state}
                  onChangeText={(text: string) => setAddressForm((prev) => ({ ...prev, state: text }))}
                  commitOnBlur={false}
                />
              </View>
              <View style={styles.row}>
                <DraftTextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Postal code"
                  value={addressForm.postalCode}
                  onChangeText={(text: string) => setAddressForm((prev) => ({ ...prev, postalCode: text }))}
                  commitOnBlur={false}
                />
                <DraftTextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Country"
                  value={addressForm.country}
                  onChangeText={(text: string) => setAddressForm((prev) => ({ ...prev, country: text }))}
                  commitOnBlur={false}
                />
              </View>
              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.button, styles.dangerButton, { flex: 1 }]}
                  onPress={() => {
                    setAddressForm(parseHomeAddress(accountProfile.homeAddress));
                    setShowAddressEditor(false);
                  }}
                >
                  <Text style={styles.dangerButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, { flex: 1 }]}
                  onPress={() => {
                    setAccountProfile((prev) => ({ ...prev, homeAddress: formatHomeAddress(addressForm) }));
                    setShowAddressEditor(false);
                  }}
                >
                  <Text style={styles.buttonText}>Save Address</Text>
                </TouchableOpacity>
              </View>
        </DialogShell>
      ) : null}
    </View>
  );
};

export default AccountProfileManagement;
