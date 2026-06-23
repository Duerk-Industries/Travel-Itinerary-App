import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useColorScheme } from 'react-native';
import { type MapApp, isMapApp } from '../utils/mapLinks';
import { type AppearancePreference, isAppearancePreference } from '../utils/appearancePreference';
import { type TemperatureUnit, normalizeTemperatureUnit } from '../utils/temperatureUnit';
import FamilyRelationships from './FamilyRelationships';
import AccountTraits from './AccountTraits';
import AccountProfileManagement from './AccountProfileManagement';
import PackingListTable from '../components/PackingListTable';
import { getAppTheme } from '../theme/theme';
import { type Trait } from './traits';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

export interface AccountProfile {
  firstName: string;
  lastName: string;
  email: string;
  homeAddress: string;
  preferredAirport: string;
  mapPreference?: MapApp;
  appearancePreference: AppearancePreference;
  temperatureUnit: TemperatureUnit;
  entitlements?: {
    costTracking?: boolean;
  };
}

export interface FellowTraveler {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
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
  setMapPreference?: (pref: MapApp) => void;
  setAppearancePreference?: (pref: AppearancePreference) => void;
  setUserName: Setter<string | null>;
  setUserEmail: Setter<string | null>;
}

export type FetchAccountProfileResult = {
  ok: boolean;
  entitlements?: AccountProfile['entitlements'];
};

export const fetchAccountProfile = async ({
  backendUrl,
  token,
  logout,
  setAccountProfile,
  setMapPreference,
  setAppearancePreference,
  setUserName,
  setUserEmail,
}: FetchAccountProfileParams): Promise<FetchAccountProfileResult> => {
  if (!token) return { ok: false };
  try {
    const res = await fetch(`${backendUrl}/api/account`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      logout();
      return { ok: false };
    }
    if (!res.ok) return { ok: false };
    const data = await res.json();
    const fullName = `${data.firstName ?? ''} ${data.lastName ?? ''}`.trim() || data.email || 'Traveler';
    const mapPreference = isMapApp(data.mapPreference) ? data.mapPreference : undefined;
    const appearancePreference = isAppearancePreference(data.appearancePreference) ? data.appearancePreference : undefined;
    const temperatureUnit = normalizeTemperatureUnit(data.temperatureUnit);
    if (mapPreference && setMapPreference) setMapPreference(mapPreference);
    if (appearancePreference && setAppearancePreference) setAppearancePreference(appearancePreference);
    setAccountProfile((prev) => ({
      firstName: data.firstName ?? '',
      lastName: data.lastName ?? '',
      email: data.email ?? '',
      homeAddress: data.homeAddress ?? '',
      preferredAirport: data.preferredAirport ?? '',
      mapPreference: mapPreference ?? prev.mapPreference ?? 'google',
      appearancePreference: appearancePreference ?? prev.appearancePreference ?? 'auto',
      temperatureUnit,
      entitlements: data.entitlements ?? prev.entitlements,
    }));
    setUserName(fullName);
    setUserEmail(data.email ?? null);
    return { ok: true, entitlements: data.entitlements };
  } catch {
    return { ok: false };
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
  appearancePreference: AppearancePreference;
  onChangeAppearancePreference: (pref: AppearancePreference) => void;
  saveSession: (token: string, name: string, page?: string, email?: string | null) => void | Promise<void>;
  headers: Headers;
  jsonHeaders: Headers;
  airportOptions: string[];
  onSearchAirports: (q: string) => Promise<void> | void;
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
  const colorScheme = useColorScheme();
  const theme = getAppTheme(appearancePreference, colorScheme);
  const [showPackingList, setShowPackingList] = useState(false);

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
        appearancePreference={appearancePreference}
        onChangeAppearancePreference={onChangeAppearancePreference}
        saveSession={saveSession}
        headers={headers}
        jsonHeaders={jsonHeaders}
        airportOptions={airportOptions}
        onSearchAirports={onSearchAirports}
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
        hideFamilySection
        styles={styles}
      />
      <View style={[localStyles.packingLauncher, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
        <View style={localStyles.packingLauncherText}>
          <Text style={[localStyles.packingTitle, { color: theme.colors.text }]}>Default packing list</Text>
          <Text style={[localStyles.packingMeta, { color: theme.colors.textMuted }]}>Manage the items copied into trips when you are added.</Text>
        </View>
        <Pressable
          style={[styles.button, localStyles.packingButton]}
          onPress={() => setShowPackingList(true)}
          testID="account-open-packing-list"
        >
          <Text style={styles.buttonText}>Open List</Text>
        </Pressable>
      </View>
      {showPackingList ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setShowPackingList(false)}>
          <View style={[localStyles.modalOverlay, { backgroundColor: theme.mode === 'dark' ? 'rgba(0,0,0,0.68)' : 'rgba(17,24,39,0.35)' }]} testID="account-packing-list-modal">
            <View style={[localStyles.modalCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <View style={localStyles.modalHeader}>
                <Text style={[localStyles.modalTitle, { color: theme.colors.text }]}>Default packing list</Text>
                <Pressable
                  onPress={() => setShowPackingList(false)}
                  style={[localStyles.closeButton, { backgroundColor: theme.colors.surfaceMuted }]}
                  testID="account-close-packing-list"
                >
                  <Text style={[localStyles.closeText, { color: theme.colors.text }]}>x</Text>
                </Pressable>
              </View>
              <ScrollView style={localStyles.modalBody} contentContainerStyle={localStyles.modalBodyContent}>
                <PackingListTable
                  backendUrl={backendUrl}
                  headers={headers}
                  variant="user"
                  title="Default packing list"
                />
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
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
    </View>
  );
};

const localStyles = StyleSheet.create({
  packingLauncher: { borderWidth: 1, borderRadius: 8, padding: 14, marginVertical: 12, gap: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' },
  packingLauncherText: { flex: 1, gap: 4 },
  packingTitle: { fontSize: 18, fontWeight: '700', flexShrink: 1 },
  packingMeta: { fontSize: 13 },
  packingButton: { alignSelf: 'center', maxWidth: '100%' },
  modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: { width: '100%', maxWidth: 980, maxHeight: '88%', borderWidth: 1, borderRadius: 8, padding: 16 },
  modalHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  modalTitle: { fontSize: 20, fontWeight: '700', flexShrink: 1 },
  closeButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  closeText: { fontSize: 18, fontWeight: '700' },
  modalBody: { maxHeight: 680 },
  modalBodyContent: { paddingBottom: 8 },
});

export default AccountTab;
