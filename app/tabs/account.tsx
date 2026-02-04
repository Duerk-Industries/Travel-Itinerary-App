import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { type MapApp } from '../utils/mapLinks';
import ExpenseCovering from './ExpenseCovering';
import FamilyRelationships from './FamilyRelationships';
import AccountTraits from './AccountTraits';
import AccountProfileManagement from './AccountProfileManagement';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

export interface AccountProfile {
  firstName: string;
  lastName: string;
  email: string;
  mapPreference?: MapApp;
}

export interface FellowTraveler {
  id: string;
  firstName: string;
  lastName: string;
  createdAt: string;
}

interface GroupMemberOption {
  id: string;
  guestName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  status?: 'active' | 'pending' | 'removed';
  removedAt?: string | null;
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
  setMapPreference?: (pref: MapApp) => void;
  setUserName: Setter<string | null>;
  setUserEmail: Setter<string | null>;
}

export const fetchAccountProfile = async ({
  backendUrl,
  token,
  logout,
  setAccountProfile,
  setMapPreference,
  setUserName,
  setUserEmail,
}: FetchAccountProfileParams): Promise<boolean> => {
  if (!token) return false;
  try {
    const res = await fetch(`${backendUrl}/api/account`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      logout();
      return false;
    }
    if (!res.ok) return false;
    const data = await res.json();
    const fullName = `${data.firstName ?? ''} ${data.lastName ?? ''}`.trim() || 'Traveler';
    const mapPreference = isMapApp(data.mapPreference) ? data.mapPreference : undefined;
    if (mapPreference && setMapPreference) setMapPreference(mapPreference);
    setAccountProfile((prev) => ({
      firstName: data.firstName ?? '',
      lastName: data.lastName ?? '',
      email: data.email ?? '',
      mapPreference: mapPreference ?? prev.mapPreference ?? 'google',
    }));
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
  mapApp: MapApp;
  onChangeMapApp: (pref: MapApp) => void;
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
  groupMembers: GroupMemberOption[];
  reportableMembers: GroupMemberOption[];
  coveredBy: Record<string, string>;
  setCoveredBy: Setter<Record<string, string>>;
  formatMemberName: (member: GroupMemberOption) => string;
  payerName: (id: string) => string;
  saveCoveredBy: () => Promise<void>;
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
  mapApp,
  onChangeMapApp,
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
  groupMembers,
  reportableMembers,
  coveredBy,
  setCoveredBy,
  formatMemberName,
  payerName,
  saveCoveredBy,
}) => {
  return (
    <View>
      <AccountProfileManagement
        backendUrl={backendUrl}
        userToken={userToken}
        activePage={activePage}
        accountProfile={accountProfile}
        setAccountProfile={setAccountProfile}
        setUserToken={setUserToken}
        setUserName={setUserName}
        setUserEmail={setUserEmail}
        mapApp={mapApp}
        onChangeMapApp={onChangeMapApp}
        saveSession={saveSession}
        headers={headers}
        jsonHeaders={jsonHeaders}
        logout={logout}
        styles={styles}
      />
      <FamilyRelationships
        backendUrl={backendUrl}
        userToken={userToken}
        headers={headers}
        jsonHeaders={jsonHeaders}
        familyRelationships={familyRelationships}
        setFamilyRelationships={setFamilyRelationships}
        fellowTravelers={fellowTravelers}
        setFellowTravelers={setFellowTravelers}
        showRelationshipDropdown={showRelationshipDropdown}
        setShowRelationshipDropdown={setShowRelationshipDropdown}
        styles={styles}
      />
      <AccountTraits
        backendUrl={backendUrl}
        userToken={userToken}
        headers={headers}
        jsonHeaders={jsonHeaders}
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
        fetchTraits={fetchTraits}
        fetchTraitProfile={fetchTraitProfile}
        styles={styles}
      />
      <ExpenseCovering
        groupMembers={groupMembers}
        reportableMembers={reportableMembers}
        coveredBy={coveredBy}
        setCoveredBy={setCoveredBy}
        formatMemberName={formatMemberName}
        payerName={payerName}
        saveCoveredBy={saveCoveredBy}
        styles={styles}
      />
    </View>
  );
};

export default AccountTab;
