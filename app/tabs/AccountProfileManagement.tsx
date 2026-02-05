import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { type MapApp, isMapApp, mapAppOptions } from '../utils/mapLinks';
import { AccountProfile } from './account';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;
type Styles = ReturnType<typeof StyleSheet.create>;
type Headers = Record<string, string>;

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
  saveSession: (token: string, name: string, page?: string, email?: string | null) => void;
  headers: Headers;
  jsonHeaders: Headers;
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
  saveSession,
  headers,
  jsonHeaders,
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
    onChangeMapApp(nextMapPreference);
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
      mapPreference: nextMapPreference,
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
        <TextInput style={[styles.input, { flex: 1 }]} placeholder="First name" value={accountProfile.firstName} onChangeText={(text) => setAccountProfile((p) => ({ ...p, firstName: text }))} />
        <TextInput style={[styles.input, { flex: 1 }]} placeholder="Last name" value={accountProfile.lastName} onChangeText={(text) => setAccountProfile((p) => ({ ...p, lastName: text }))} />
      </View>
      <TextInput style={styles.input} placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={accountProfile.email} onChangeText={(text) => setAccountProfile((p) => ({ ...p, email: text }))} />
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
      <TouchableOpacity style={styles.button} onPress={handleProfileUpdate}>
        <Text style={styles.buttonText}>Save Profile</Text>
      </TouchableOpacity>

      <View style={styles.divider} />
      {!showPasswordEditor ? (
        <TouchableOpacity style={styles.button} onPress={() => setShowPasswordEditor(true)}>
          <Text style={styles.buttonText}>Change Password</Text>
        </TouchableOpacity>
      ) : (
        <>
          <Text style={styles.modalLabel}>Change password</Text>
          <TextInput style={styles.input} placeholder="Current password" secureTextEntry value={passwordForm.currentPassword} onChangeText={(text) => setPasswordForm(p => ({ ...p, currentPassword: text }))} />
          <TextInput style={styles.input} placeholder="New password" secureTextEntry value={passwordForm.newPassword} onChangeText={(text) => setPasswordForm(p => ({ ...p, newPassword: text }))} />
          <TextInput style={styles.input} placeholder="Confirm new password" secureTextEntry value={passwordForm.newPasswordConfirm} onChangeText={(text) => setPasswordForm(p => ({ ...p, newPasswordConfirm: text }))} />
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.button, styles.dangerButton, { flex: 1 }]}
              onPress={() => {
                setPasswordForm({ currentPassword: '', newPassword: '', newPasswordConfirm: '' });
                setShowPasswordEditor(false);
              }}
            >
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={handlePasswordChange}>
              <Text style={styles.buttonText}>Update Password</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <View style={styles.divider} />
      <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={() => setShowDeleteConfirm(true)}>
        <Text style={styles.buttonText}>Delete Account</Text>
      </TouchableOpacity>
      {showDeleteConfirm ? (
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModal}>
            <Text style={styles.sectionTitle}>Delete account?</Text>
            <Text style={styles.helperText}>This cannot be undone. All solo trips and data will be removed.</Text>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={() => setShowDeleteConfirm(false)}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, styles.dangerButton, { flex: 1 }]} onPress={handleDeleteAccount}>
                <Text style={styles.buttonText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
};

export default AccountProfileManagement;