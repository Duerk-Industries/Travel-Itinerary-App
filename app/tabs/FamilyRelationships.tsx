import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DraftTextInput from '../components/DraftTextInput';
import SelectField, { type SelectFieldOption } from '../components/SelectField';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

export interface FellowTraveler {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  createdAt: string;
}
type FamilyForm = { givenName: string; middleName: string; familyName: string; email: string; relationship: string };
type FellowTravelerForm = { firstName: string; lastName: string; email: string };

type Styles = ReturnType<typeof StyleSheet.create>;
type Headers = Record<string, string>;

interface FamilyRelationshipsProps {
  backendUrl: string;
  userToken: string | null;
  headers: Headers;
  jsonHeaders: Headers;
  familyRelationships: any[];
  setFamilyRelationships: Setter<any[]>;
  fellowTravelers: FellowTraveler[];
  setFellowTravelers: Setter<FellowTraveler[]>;
  showRelationshipDropdown: boolean;
  setShowRelationshipDropdown: Setter<boolean>;
  hideFamilySection?: boolean;
  styles: Styles;
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
const relationshipSelectOptions: SelectFieldOption[] = relationshipOptions.map((option) => ({
  label: option,
  value: option,
}));

const FamilyRelationships: React.FC<FamilyRelationshipsProps> = ({
  backendUrl,
  userToken,
  headers,
  jsonHeaders,
  familyRelationships,
  setFamilyRelationships,
  fellowTravelers,
  setFellowTravelers,
  setShowRelationshipDropdown,
  hideFamilySection = false,
  styles,
}) => {
  const [familyForm, setFamilyForm] = useState<FamilyForm>({ givenName: '', middleName: '', familyName: '', email: '', relationship: 'Not Applicable' });
  const [editingFamilyId, setEditingFamilyId] = useState<string | null>(null);
  const [editingFamilyDraft, setEditingFamilyDraft] = useState<FamilyForm | null>(null);
  const [fellowForm, setFellowForm] = useState<FellowTravelerForm>({ firstName: '', lastName: '', email: '' });
  const [editingFellowId, setEditingFellowId] = useState<string | null>(null);
  const [editingFellowDraft, setEditingFellowDraft] = useState<FellowTravelerForm | null>(null);

  const addFellowTraveler = async () => {
    if (!userToken) return;
    const { firstName, lastName, email } = fellowForm;
    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert('Enter first and last name');
      return;
    }
    const res = await fetch(`${backendUrl}/api/account/fellow-travelers`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim() || null }),
    });
    const data = await res.json().catch(() => ([]));
    if (!res.ok) {
      Alert.alert(data.error || 'Unable to add fellow traveler');
      return;
    }
    setFellowTravelers(data);
    setFellowForm({ firstName: '', lastName: '', email: '' });
  };

  const saveFellowTraveler = async () => {
    if (!userToken || !editingFellowId || !editingFellowDraft) return;
    const res = await fetch(`${backendUrl}/api/account/fellow-travelers/${editingFellowId}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({
        firstName: editingFellowDraft.firstName.trim(),
        lastName: editingFellowDraft.lastName.trim(),
        email: editingFellowDraft.email.trim() || null,
      }),
    });
    const data = await res.json().catch(() => ([]));
    if (!res.ok) {
      Alert.alert(data.error || 'Unable to update fellow traveler');
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
      Alert.alert(data.error || 'Unable to remove fellow traveler');
      return;
    }
    setFellowTravelers(data);
  };

  const addFamilyMember = async () => {
    if (!userToken) return;
    const { givenName, familyName, relationship } = familyForm;
    if (!givenName.trim() || !familyName.trim()) {
      Alert.alert('Fill out given and family name');
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
      Alert.alert((data as any).error || 'Unable to add family member');
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
      Alert.alert((data as any).error || 'Unable to accept relationship');
      return;
    }
    setFamilyRelationships(data);
  };

  const rejectFamilyLink = async (id: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/account/family/${id}/reject`, { method: 'PATCH', headers });
    const data = await res.json().catch(() => ([]));
    if (!res.ok) {
      Alert.alert((data as any).error || 'Unable to reject relationship');
      return;
    }
    setFamilyRelationships(data);
  };

  const removeFamilyLink = async (id: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/account/family/${id}`, { method: 'DELETE', headers });
    const data = await res.json().catch(() => ([]));
    if (!res.ok) {
      Alert.alert((data as any).error || 'Unable to remove relationship');
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
      Alert.alert((data as any).error || 'Unable to update family profile');
      return;
    }
    setFamilyRelationships(data);
    setEditingFamilyId(null);
    setEditingFamilyDraft(null);
  };

  return (
    <View style={styles.card}>
      {!hideFamilySection ? (
        <>
      <Text style={styles.sectionTitle}>Family & Relationships</Text>
      <Text style={styles.helperText}>Add relatives, accept invites, and manage non-user profiles.</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Given name"
          value={familyForm.givenName}
          onChangeText={(text: string) => setFamilyForm((p) => ({ ...p, givenName: text }))}
        />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Middle name"
          value={familyForm.middleName}
          onChangeText={(text: string) => setFamilyForm((p) => ({ ...p, middleName: text }))}
        />
      </View>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Family name"
          value={familyForm.familyName}
          onChangeText={(text: string) => setFamilyForm((p) => ({ ...p, familyName: text }))}
        />
        <SelectField
          styles={styles}
          value={familyForm.relationship}
          options={relationshipSelectOptions}
          placeholder="Not Applicable"
          title="Relationship"
          style={{ flex: 1 }}
          onChange={(value) => {
            setFamilyForm((p) => ({ ...p, relationship: value || 'Not Applicable' }));
            setShowRelationshipDropdown(false);
          }}
        />
      </View>
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        value={familyForm.email}
        onChangeText={(text: string) => setFamilyForm((p) => ({ ...p, email: text }))}
      />
      <TouchableOpacity style={styles.button} onPress={addFamilyMember}>
        <Text style={styles.buttonText}>Add Family Member</Text>
      </TouchableOpacity>

      {familyRelationships.length ? (
        <View style={{ marginTop: 12 }}>
          {familyRelationships.map((rel) => {
            const normalize = (val?: string | null) => {
              const t = String(val ?? '').trim();
              if (!t || t.toLowerCase() === 'unknown') return '';
              return t;
            };
            const first = normalize(rel.relative.firstName);
            const middle = normalize(rel.relative.middleName);
            const last = normalize(rel.relative.lastName);
            const emailLabel = rel.relative.email || 'No email';
            const name = `${first} ${middle} ${last}`.replace(/\s+/g, ' ').trim();
            const isPendingInbound = rel.status === 'pending' && rel.direction === 'inbound';
            const isEditable = rel.editableProfile;
            const isEditing = editingFamilyId === rel.id;
            return (
              <View key={rel.id} style={styles.familyRow}>
                <Text style={styles.bodyText}>
                  {name || emailLabel} ({emailLabel})
                </Text>
                <Text style={styles.helperText}>Relationship: {rel.relationship} | Status: {rel.status}</Text>
                {isPendingInbound ? (
                  <View style={styles.row}>
                    <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={() => acceptFamilyLink(rel.id)}>
                      <Text style={styles.buttonText}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.dangerButton, { flex: 1 }]} onPress={() => rejectFamilyLink(rel.id)}>
                      <Text style={styles.dangerButtonText}>Reject</Text>
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
                        onChangeText={(text: string) => setEditingFamilyDraft((p) => (p ? { ...p, givenName: text } : p))}
                      />
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        placeholder="Middle"
                        value={editingFamilyDraft.middleName}
                        onChangeText={(text: string) => setEditingFamilyDraft((p) => (p ? { ...p, middleName: text } : p))}
                      />
                    </View>
                    <TextInput
                      style={styles.input}
                      placeholder="Family"
                      value={editingFamilyDraft.familyName}
                      onChangeText={(text: string) => setEditingFamilyDraft((p) => (p ? { ...p, familyName: text } : p))}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="Email"
                      autoCapitalize="none"
                      autoComplete="email"
                      textContentType="emailAddress"
                      keyboardType="email-address"
                      value={editingFamilyDraft.email}
                      onChangeText={(text: string) => setEditingFamilyDraft((p) => (p ? { ...p, email: text } : p))}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="Relationship"
                      value={editingFamilyDraft.relationship}
                      onChangeText={(text: string) => setEditingFamilyDraft((p) => (p ? { ...p, relationship: text } : p))}
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
                        <Text style={styles.dangerButtonText}>Cancel</Text>
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
        </>
      ) : null}
      <Text style={styles.sectionTitle}>Fellow Travelers</Text>
      <Text style={styles.helperText}>Manage travelers from your past trips. Email is optional.</Text>
      <View style={styles.row}>
        <DraftTextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="First name"
          autoComplete="given-name"
          textContentType="givenName"
          value={fellowForm.firstName}
          onChangeText={(text: string) => setFellowForm((p) => ({ ...p, firstName: text }))}
          commitOnBlur={false}
        />
        <DraftTextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Last name"
          autoComplete="family-name"
          textContentType="familyName"
          value={fellowForm.lastName}
          onChangeText={(text: string) => setFellowForm((p) => ({ ...p, lastName: text }))}
          commitOnBlur={false}
        />
      </View>
        <DraftTextInput
        style={styles.input}
        placeholder="Email (optional)"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        value={fellowForm.email}
        onChangeText={(text: string) => setFellowForm((p) => ({ ...p, email: text }))}
        commitOnBlur={false}
      />
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
                {traveler.email ? <Text style={styles.helperText}>{traveler.email}</Text> : null}
                <View style={styles.row}>
                  <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => deleteFellowTraveler(traveler.id)}>
                    <Text style={styles.buttonText}>Remove</Text>
                  </TouchableOpacity>
                  {!isEditing ? (
                    <TouchableOpacity
                      style={[styles.button, styles.smallButton]}
                      onPress={() => {
                        setEditingFellowId(traveler.id);
                        setEditingFellowDraft({
                          firstName: traveler.firstName,
                          lastName: traveler.lastName,
                          email: traveler.email ?? '',
                        });
                      }}
                    >
                      <Text style={styles.buttonText}>Edit</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {isEditing && editingFellowDraft ? (
                  <View style={{ marginTop: 8 }}>
                    <View style={styles.row}>
      <DraftTextInput
                        style={[styles.input, { flex: 1 }]}
                        placeholder="First name"
                        autoComplete="given-name"
                        textContentType="givenName"
                        value={editingFellowDraft.firstName}
                        onChangeText={(text: string) => setEditingFellowDraft((p) => (p ? { ...p, firstName: text } : p))}
                        commitOnBlur={false}
                      />
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        placeholder="Last name"
                        autoComplete="family-name"
                        textContentType="familyName"
                        value={editingFellowDraft.lastName}
                        onChangeText={(text: string) => setEditingFellowDraft((p) => (p ? { ...p, lastName: text } : p))}
                      />
                    </View>
                    <TextInput
                      style={styles.input}
                      placeholder="Email (optional)"
                      autoCapitalize="none"
                      autoComplete="email"
                      textContentType="emailAddress"
                      keyboardType="email-address"
                      value={editingFellowDraft.email}
                      onChangeText={(text: string) => setEditingFellowDraft((p) => (p ? { ...p, email: text } : p))}
                    />
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
                        <Text style={styles.dangerButtonText}>Cancel</Text>
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
    </View>
  );
};

export default FamilyRelationships;
