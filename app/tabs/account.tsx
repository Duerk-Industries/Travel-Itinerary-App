import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { TraitsTab, type Trait } from './traits';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

export interface AccountProfile {
  firstName: string;
  lastName: string;
  email: string;
}

export interface FellowTraveler {
  id: string;
  firstName: string;
  lastName: string;
  createdAt: string;
}

type FamilyForm = { givenName: string; middleName: string; familyName: string; email: string; relationship: string };
type FellowTravelerForm = { firstName: string; lastName: string };

type Styles = ReturnType<typeof StyleSheet.create>;

type Headers = Record<string, string>;

interface FetchAccountProfileParams {
  backendUrl: string;
  token?: string | null;
  logout: () => void;
  setAccountProfile: Setter<AccountProfile>;
  setUserName: Setter<string | null>;
  setUserEmail: Setter<string | null>;
}

export const fetchAccountProfile = async ({
  backendUrl,
  token,
  logout,
  setAccountProfile,
  setUserName,
  setUserEmail,
}: FetchAccountProfileParams): Promise<boolean> => {
  if (!token) return false;
  try {
    const res = await fetch(`${backendUrl}/api/account`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) {
      logout();
      return false;
    }
    if (!res.ok) return false;
    const data = await res.json();
    const fullName = `${data.firstName ?? ''} ${data.lastName ?? ''}`.trim() || 'Traveler';
    setAccountProfile({
      firstName: data.firstName ?? '',
      lastName: data.lastName ?? '',
      email: data.email ?? '',
    });
    setUserName(fullName);
    setUserEmail(data.email ?? null);
    return true;
  } catch {
    return false;
  }
};

interface FetchFamilyRelationshipsParams {
  backendUrl: string;
  token?: string | null;
  setFamilyRelationships: Setter<any[]>;
}

export const fetchFamilyRelationships = async ({ backendUrl, token, setFamilyRelationships }: FetchFamilyRelationshipsParams) => {
  if (!token) return;
  try {
    const res = await fetch(`${backendUrl}/api/account/family`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const data = await res.json();
    setFamilyRelationships(data);
  } catch {
    // ignore
  }
};

interface FetchFellowTravelersParams {
  backendUrl: string;
  token?: string | null;
  setFellowTravelers: Setter<FellowTraveler[]>;
}

export const fetchFellowTravelers = async ({ backendUrl, token, setFellowTravelers }: FetchFellowTravelersParams) => {
  if (!token) return;
  try {
    const res = await fetch(`${backendUrl}/api/account/fellow-travelers`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const data = await res.json();
    setFellowTravelers(data);
  } catch {
    // ignore
  }
};

interface AccountTabProps {
  backendUrl: string;
  userToken: string | null;
  activePage: string;
  accountProfile: AccountProfile;
  setAccountProfile: Setter<AccountProfile>;
  familyRelationships: any[];
  setFamilyRelationships: Setter<any[]>;
  fellowTravelers: FellowTraveler[];
  setFellowTravelers: Setter<FellowTraveler[]>;
  showRelationshipDropdown: boolean;
  setShowRelationshipDropdown: Setter<boolean>;
  setUserToken: Setter<string | null>;
  setUserName: Setter<string | null>;
  setUserEmail: Setter<string | null>;
  saveSession: (token: string, name: string, page?: string, email?: string | null) => void;
  headers: Headers;
  jsonHeaders: Headers;
  logout: () => void;
  styles: Styles;
  traits: Trait[];
  setTraits: React.Dispatch<React.SetStateAction<Trait[]>>;
  selectedTraitNames: Set<string>;
  setSelectedTraitNames: React.Dispatch<React.SetStateAction<Set<string>>>;
  traitAge: string;
  setTraitAge: React.Dispatch<React.SetStateAction<string>>;
  traitGender: 'female' | 'male' | 'nonbinary' | 'prefer-not';
  setTraitGender: React.Dispatch<React.SetStateAction<'female' | 'male' | 'nonbinary' | 'prefer-not'>>;
  newTraitName: string;
  setNewTraitName: React.Dispatch<React.SetStateAction<string>>;
  fetchTraits: () => Promise<void>;
  fetchTraitProfile: () => Promise<void>;
}

const relationshipOptions = [
  'Not Applicable',
  'Parent',
  'Child',
  'Sibling',
  'Spouse/Partner',
  'Grandparent',
  'Grandchild',
  'Aunt/Uncle',
  'Niece/Nephew',
  'Cousin',
  'Friend',
];

const AccountTab: React.FC<AccountTabProps> = ({
  backendUrl,
  userToken,
  activePage,
  accountProfile,
  setAccountProfile,
  familyRelationships,
  setFamilyRelationships,
  fellowTravelers,
  setFellowTravelers,
  showRelationshipDropdown,
  setShowRelationshipDropdown,
  setUserToken,
  setUserName,
  setUserEmail,
  saveSession,
  headers,
  jsonHeaders,
  logout,
  styles,
  traits,
  setTraits,
  selectedTraitNames,
  setSelectedTraitNames,
  traitAge,
  setTraitAge,
  traitGender,
  setTraitGender,
  newTraitName,
  setNewTraitName,
  fetchTraits,
  fetchTraitProfile,
}) => {
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', newPasswordConfirm: '' });
  const [showPasswordEditor, setShowPasswordEditor] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [familyForm, setFamilyForm] = useState<FamilyForm>({ givenName: '', middleName: '', familyName: '', email: '', relationship: 'Not Applicable' });
  const [editingFamilyId, setEditingFamilyId] = useState<string | null>(null);
  const [editingFamilyDraft, setEditingFamilyDraft] = useState<FamilyForm | null>(null);
  const [fellowForm, setFellowForm] = useState<FellowTravelerForm>({ firstName: '', lastName: '' });
  const [editingFellowId, setEditingFellowId] = useState<string | null>(null);
  const [editingFellowDraft, setEditingFellowDraft] = useState<FellowTravelerForm | null>(null);

  const updateAccountProfile = async () => {
    if (!userToken) return;
    setAccountMessage(null);
    const res = await fetch(`${backendUrl}/api/account/profile`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(accountProfile),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to update profile');
      return;
    }
    const updatedUser = data.user ?? accountProfile;
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
    });
    setAccountMessage('Profile updated');
  };

  const updateAccountPassword = async () => {
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

  const deleteAccount = async () => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/account`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to delete account');
      return;
    }
    setShowDeleteConfirm(false);
    logout();
  };

  const addFellowTraveler = async () => {
    if (!userToken) return;
    const { firstName, lastName } = fellowForm;
    if (!firstName.trim() || !lastName.trim()) {
      alert('Enter first and last name');
      return;
    }
    const res = await fetch(`${backendUrl}/api/account/fellow-travelers`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim() }),
    });
    const data = await res.json().catch(() => ([]));
    if (!res.ok) {
      alert(data.error || 'Unable to add fellow traveler');
      return;
    }
    setFellowTravelers(data);
    setFellowForm({ firstName: '', lastName: '' });
  };

  const saveFellowTraveler = async () => {
    if (!userToken || !editingFellowId || !editingFellowDraft) return;
    const res = await fetch(`${backendUrl}/api/account/fellow-travelers/${editingFellowId}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({
        firstName: editingFellowDraft.firstName.trim(),
        lastName: editingFellowDraft.lastName.trim(),
      }),
    });
    const data = await res.json().catch(() => ([]));
    if (!res.ok) {
      alert(data.error || 'Unable to update fellow traveler');
      return;
    }
    setFellowTravelers(data);
    setEditingFellowId(null);
    setEditingFellowDraft(null);
  };

  const deleteFellowTraveler = async (travelerId: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/account/fellow-travelers/${travelerId}`, {
      method: 'DELETE',
      headers,
    });
    const data = await res.json().catch(() => ([]));
    if (!res.ok) {
      alert(data.error || 'Unable to remove fellow traveler');
      return;
    }
    setFellowTravelers(data);
  };

  const addFamilyMember = async () => {
    if (!userToken) return;
    const { givenName, familyName, relationship } = familyForm;
    if (!givenName.trim() || !familyName.trim()) {
      alert('Fill out given and family name');
      return;
    }
    const payload = {
      ...familyForm,
      relationship: relationship?.trim() || 'Not Applicable',
    };
    const res = await fetch(`${backendUrl}/api/account/family`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ([]));
    if (!res.ok) {
      alert((data as any).error || 'Unable to add family member');
      return;
    }
    setFamilyRelationships(data);
    setFamilyForm({ givenName: '', middleName: '', familyName: '', email: '', relationship: 'Not Applicable' });
    setShowRelationshipDropdown(false);
  };

  const acceptFamilyLink = async (id: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/account/family/${id}/accept`, { method: 'PATCH', headers });
    const data = await res.json().catch(() => ([]));
    if (!res.ok) {
      alert((data as any).error || 'Unable to accept relationship');
      return;
    }
    setFamilyRelationships(data);
  };

  const rejectFamilyLink = async (id: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/account/family/${id}/reject`, { method: 'PATCH', headers });
    const data = await res.json().catch(() => ([]));
    if (!res.ok) {
      alert((data as any).error || 'Unable to reject relationship');
      return;
    }
    setFamilyRelationships(data);
  };

  const removeFamilyLink = async (id: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/account/family/${id}`, { method: 'DELETE', headers });
    const data = await res.json().catch(() => ([]));
    if (!res.ok) {
      alert((data as any).error || 'Unable to remove relationship');
      return;
    }
    setFamilyRelationships(data);
    if (editingFamilyId === id) {
      setEditingFamilyId(null);
      setEditingFamilyDraft(null);
    }
  };

  const saveFamilyProfile = async () => {
    if (!userToken || !editingFamilyId || !editingFamilyDraft) return;
    const res = await fetch(`${backendUrl}/api/account/family/${editingFamilyId}/profile`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(editingFamilyDraft),
    });
    const data = await res.json().catch(() => ([]));
    if (!res.ok) {
      alert((data as any).error || 'Unable to update family profile');
      return;
    }
    setFamilyRelationships(data);
    setEditingFamilyId(null);
    setEditingFamilyDraft(null);
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
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="First name"
          value={accountProfile.firstName}
          onChangeText={(text) => setAccountProfile((p) => ({ ...p, firstName: text }))}
        />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Last name"
          value={accountProfile.lastName}
          onChangeText={(text) => setAccountProfile((p) => ({ ...p, lastName: text }))}
        />
      </View>
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={accountProfile.email}
        onChangeText={(text) => setAccountProfile((p) => ({ ...p, email: text }))}
      />
      <TouchableOpacity style={styles.button} onPress={updateAccountProfile}>
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
          <TextInput
            style={styles.input}
            placeholder="Current password"
            secureTextEntry
            value={passwordForm.currentPassword}
            onChangeText={(text) => setPasswordForm((p) => ({ ...p, currentPassword: text }))}
          />
          <TextInput
            style={styles.input}
            placeholder="New password"
            secureTextEntry
            value={passwordForm.newPassword}
            onChangeText={(text) => setPasswordForm((p) => ({ ...p, newPassword: text }))}
          />
          <TextInput
            style={styles.input}
            placeholder="Confirm new password"
            secureTextEntry
            value={passwordForm.newPasswordConfirm}
            onChangeText={(text) => setPasswordForm((p) => ({ ...p, newPasswordConfirm: text }))}
          />
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
            <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={updateAccountPassword}>
              <Text style={styles.buttonText}>Update Password</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <View style={styles.divider} />
      <Text style={styles.sectionTitle}>Family & Relationships</Text>
      <Text style={styles.helperText}>Add relatives, accept invites, and manage non-user profiles.</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Given name"
          value={familyForm.givenName}
          onChangeText={(text) => setFamilyForm((p) => ({ ...p, givenName: text }))}
        />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Middle name"
          value={familyForm.middleName}
          onChangeText={(text) => setFamilyForm((p) => ({ ...p, middleName: text }))}
        />
      </View>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Family name"
          value={familyForm.familyName}
          onChangeText={(text) => setFamilyForm((p) => ({ ...p, familyName: text }))}
        />
        <View style={[styles.input, styles.dropdown, { flex: 1 }]}>
          <TouchableOpacity onPress={() => setShowRelationshipDropdown((s) => !s)}>
            <View style={styles.selectButtonRow}>
              <Text style={familyForm.relationship ? styles.cellText : styles.placeholderText}>
                {familyForm.relationship || 'Not Applicable'}
              </Text>
              <Text style={styles.selectCaret}>v</Text>
            </View>
          </TouchableOpacity>
          {showRelationshipDropdown ? (
            <View style={styles.dropdownList}>
              {relationshipOptions.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={styles.dropdownOption}
                  onPress={() => {
                    setFamilyForm((p) => ({ ...p, relationship: opt }));
                    setShowRelationshipDropdown(false);
                  }}
                >
                  <Text style={styles.cellText}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>
      </View>
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={familyForm.email}
        onChangeText={(text) => setFamilyForm((p) => ({ ...p, email: text }))}
      />
      <TouchableOpacity style={styles.button} onPress={addFamilyMember}>
        <Text style={styles.buttonText}>Add Family Member</Text>
      </TouchableOpacity>

      {familyRelationships.length ? (
        <View style={{ marginTop: 12 }}>
          {familyRelationships.map((rel) => {
            const name = `${rel.relative.firstName ?? ''} ${rel.relative.middleName ?? ''} ${rel.relative.lastName ?? ''}`.replace(/\s+/g, ' ').trim();
            const isPendingInbound = rel.status === 'pending' && rel.direction === 'inbound';
            const isEditable = rel.editableProfile;
            const isEditing = editingFamilyId === rel.id;
            return (
              <View key={rel.id} style={styles.familyRow}>
                <Text style={styles.bodyText}>
                  {name || 'Unknown'} ({rel.relative.email || 'No email'})
                </Text>
                <Text style={styles.helperText}>Relationship: {rel.relationship} | Status: {rel.status}</Text>
                {isPendingInbound ? (
                  <View style={styles.row}>
                    <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={() => acceptFamilyLink(rel.id)}>
                      <Text style={styles.buttonText}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.dangerButton, { flex: 1 }]} onPress={() => rejectFamilyLink(rel.id)}>
                      <Text style={styles.buttonText}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.row}>
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => removeFamilyLink(rel.id)}>
                      <Text style={styles.buttonText}>Remove</Text>
                    </TouchableOpacity>
                    {isEditable && !isEditing ? (
                      <TouchableOpacity
                        style={[styles.button, styles.smallButton]}
                        onPress={() => {
                          setEditingFamilyId(rel.id);
                          setEditingFamilyDraft({
                            givenName: rel.relative.firstName ?? '',
                            middleName: rel.relative.middleName ?? '',
                            familyName: rel.relative.lastName ?? '',
                            email: rel.relative.email ?? '',
                            relationship: rel.relationship ?? '',
                          });
                        }}
                      >
                        <Text style={styles.buttonText}>Edit profile</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                )}

                {isEditable && isEditing && editingFamilyDraft ? (
                  <View style={{ marginTop: 8 }}>
                    <Text style={styles.modalLabel}>Edit profile</Text>
                    <View style={styles.row}>
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        placeholder="Given"
                        value={editingFamilyDraft.givenName}
                        onChangeText={(text) => setEditingFamilyDraft((p) => (p ? { ...p, givenName: text } : p))}
                      />
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        placeholder="Middle"
                        value={editingFamilyDraft.middleName}
                        onChangeText={(text) => setEditingFamilyDraft((p) => (p ? { ...p, middleName: text } : p))}
                      />
                    </View>
                    <TextInput
                      style={styles.input}
                      placeholder="Family"
                      value={editingFamilyDraft.familyName}
                      onChangeText={(text) => setEditingFamilyDraft((p) => (p ? { ...p, familyName: text } : p))}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="Email"
                      autoCapitalize="none"
                      keyboardType="email-address"
                      value={editingFamilyDraft.email}
                      onChangeText={(text) => setEditingFamilyDraft((p) => (p ? { ...p, email: text } : p))}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="Relationship"
                      value={editingFamilyDraft.relationship}
                      onChangeText={(text) => setEditingFamilyDraft((p) => (p ? { ...p, relationship: text } : p))}
                    />
                    <View style={styles.row}>
                      <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={saveFamilyProfile}>
                        <Text style={styles.buttonText}>Save</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.button, styles.dangerButton, { flex: 1 }]}
                        onPress={() => {
                          setEditingFamilyId(null);
                          setEditingFamilyDraft(null);
                        }}
                      >
                        <Text style={styles.buttonText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={styles.helperText}>No family members added yet.</Text>
      )}

      <View style={styles.divider} />
      <Text style={styles.sectionTitle}>Fellow Travelers</Text>
      <Text style={styles.helperText}>Manage travelers without email addresses from your past trips.</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="First name"
          value={fellowForm.firstName}
          onChangeText={(text) => setFellowForm((p) => ({ ...p, firstName: text }))}
        />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Last name"
          value={fellowForm.lastName}
          onChangeText={(text) => setFellowForm((p) => ({ ...p, lastName: text }))}
        />
      </View>
      <TouchableOpacity style={styles.button} onPress={addFellowTraveler}>
        <Text style={styles.buttonText}>Add Fellow Traveler</Text>
      </TouchableOpacity>

      {fellowTravelers.length ? (
        <View style={{ marginTop: 12 }}>
          {fellowTravelers.map((traveler) => {
            const isEditing = editingFellowId === traveler.id;
            return (
              <View key={traveler.id} style={styles.familyRow}>
                <Text style={styles.bodyText}>{`${traveler.firstName} ${traveler.lastName}`.trim()}</Text>
                <View style={styles.row}>
                  <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => deleteFellowTraveler(traveler.id)}>
                    <Text style={styles.buttonText}>Remove</Text>
                  </TouchableOpacity>
                  {!isEditing ? (
                    <TouchableOpacity
                      style={[styles.button, styles.smallButton]}
                      onPress={() => {
                        setEditingFellowId(traveler.id);
                        setEditingFellowDraft({ firstName: traveler.firstName, lastName: traveler.lastName });
                      }}
                    >
                      <Text style={styles.buttonText}>Edit</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {isEditing && editingFellowDraft ? (
                  <View style={{ marginTop: 8 }}>
                    <View style={styles.row}>
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        placeholder="First name"
                        value={editingFellowDraft.firstName}
                        onChangeText={(text) => setEditingFellowDraft((p) => (p ? { ...p, firstName: text } : p))}
                      />
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        placeholder="Last name"
                        value={editingFellowDraft.lastName}
                        onChangeText={(text) => setEditingFellowDraft((p) => (p ? { ...p, lastName: text } : p))}
                      />
                    </View>
                    <View style={styles.row}>
                      <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={saveFellowTraveler}>
                        <Text style={styles.buttonText}>Save</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.button, styles.dangerButton, { flex: 1 }]}
                        onPress={() => {
                          setEditingFellowId(null);
                          setEditingFellowDraft(null);
                        }}
                      >
                        <Text style={styles.buttonText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={styles.helperText}>No fellow travelers yet.</Text>
      )}

      <View style={styles.divider} />
      <TraitsTab
        backendUrl={backendUrl}
        userToken={userToken}
        traits={traits}
        setTraits={setTraits}
        selectedTraitNames={selectedTraitNames}
        setSelectedTraitNames={setSelectedTraitNames}
        traitAge={traitAge}
        setTraitAge={setTraitAge}
        traitGender={traitGender}
        setTraitGender={setTraitGender}
        newTraitName={newTraitName}
        setNewTraitName={setNewTraitName}
        headers={headers}
        jsonHeaders={jsonHeaders}
        fetchTraits={fetchTraits}
        fetchTraitProfile={fetchTraitProfile}
        styles={styles}
      />

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
              <TouchableOpacity style={[styles.button, styles.dangerButton, { flex: 1 }]} onPress={deleteAccount}>
                <Text style={styles.buttonText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
};

export default AccountTab;
