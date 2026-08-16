import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TouchableOpacity, View, useColorScheme, Linking } from 'react-native';
import { type MapApp, isMapApp } from '../utils/mapLinks';
import { type AppearancePreference, isAppearancePreference } from '../utils/appearancePreference';
import { type TemperatureUnit, normalizeTemperatureUnit } from '../utils/temperatureUnit';
import FamilyRelationships from './FamilyRelationships';
import AccountTraits from './AccountTraits';
import AccountProfileManagement from './AccountProfileManagement';
import PackingListTable from '../components/PackingListTable';
import PremiumSubscriptionPanel from '../components/PremiumSubscriptionPanel';
import { useBillingStatus } from '../hooks/useBillingStatus';
import { fetchBillingPlans, type PlanInfo } from '../utils/billing';
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
  tierKey?: string;
}

export interface FellowTraveler {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  createdAt: string;
}

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
      tierKey: data.tierKey ?? prev.tierKey,
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
  onNavigate?: (page: AccountPage) => void;
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

export type AccountPage = 'account' | 'account-fellow-travelers' | 'account-packing-list' | 'account-travel-profile';

const AccountTab: React.FC<AccountTabProps> = ({
  backendUrl,
  userToken,
  activePage,
  onNavigate = () => undefined,
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
  const [billingPlans, setBillingPlans] = useState<PlanInfo[]>([]);
  const {
    billingStatus,
    checkoutSuccessMessage,
    clearCheckoutSuccessMessage,
    refresh: refreshBillingStatus,
  } = useBillingStatus({ backendUrl, token: userToken });

  useEffect(() => {
    let cancelled = false;
    const loadBillingPlans = async () => {
      if (!userToken) {
        setBillingPlans([]);
        return;
      }
      const plans = await fetchBillingPlans(backendUrl, userToken);
      if (!cancelled) setBillingPlans(plans);
    };
    loadBillingPlans();
    return () => {
      cancelled = true;
    };
  }, [backendUrl, userToken]);

  const isSubPage = activePage !== 'account';
  const subPageTitle = activePage === 'account-fellow-travelers'
    ? 'Fellow Travelers'
    : activePage === 'account-packing-list'
      ? 'Packing List'
      : 'Travel Profile';

  const renderPageHeader = (title: string, description: string) => (
    <View style={localStyles.pageHeader}>
      <TouchableOpacity
        style={[styles.button, styles.smallButton]}
        onPress={() => onNavigate('account')}
        testID="account-subpage-back"
      >
        <Text style={styles.buttonText}>Back to Profile</Text>
      </TouchableOpacity>
      <Text style={[localStyles.pageTitle, { color: theme.colors.text }]}>{title}</Text>
      <Text style={styles.helperText}>{description}</Text>
    </View>
  );

  const renderProfileLinks = () => (
    <View style={localStyles.linksSection} testID="account-profile-links">
      <Text style={styles.sectionTitle}>Profile settings</Text>
      <Text style={styles.helperText}>Manage the details used for planning trips with your group.</Text>
      <View style={localStyles.linkGrid}>
        <TouchableOpacity
          style={[localStyles.linkCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
          onPress={() => onNavigate('account-fellow-travelers')}
          testID="account-link-fellow-travelers"
        >
          <Text style={[localStyles.linkTitle, { color: theme.colors.text }]}>Fellow Travelers</Text>
          <Text style={[localStyles.linkDescription, { color: theme.colors.textMuted }]}>Manage saved travelers and family relationships.</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[localStyles.linkCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
          onPress={() => onNavigate('account-packing-list')}
          testID="account-link-packing-list"
        >
          <Text style={[localStyles.linkTitle, { color: theme.colors.text }]}>Packing List</Text>
          <Text style={[localStyles.linkDescription, { color: theme.colors.textMuted }]}>Edit the personal items added to your trips.</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[localStyles.linkCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
          onPress={() => onNavigate('account-travel-profile')}
          testID="account-link-travel-profile"
        >
          <Text style={[localStyles.linkTitle, { color: theme.colors.text }]}>Travel Profile</Text>
          <Text style={[localStyles.linkDescription, { color: theme.colors.textMuted }]}>Save your travel style and itinerary preferences.</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View>
      {isSubPage ? renderPageHeader(
        subPageTitle,
        activePage === 'account-fellow-travelers'
          ? 'Manage the people you travel with and their saved profiles.'
          : activePage === 'account-packing-list'
            ? 'Items saved here are included when you join a trip.'
            : 'Tell us how you like to travel so itinerary suggestions fit you better.'
      ) : null}
      {!isSubPage ? <AccountProfileManagement
        theme={theme}
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
      /> : null}
      {!isSubPage ? <PremiumSubscriptionPanel
        backendUrl={backendUrl}
        token={userToken}
        billingStatus={billingStatus}
        plans={billingPlans}
        onRefresh={refreshBillingStatus}
        checkoutSuccessMessage={checkoutSuccessMessage}
        onDismissCheckoutSuccess={clearCheckoutSuccessMessage}
        appearancePreference={appearancePreference}
        systemColorScheme={colorScheme}
      /> : null}
      {!isSubPage ? renderProfileLinks() : null}
      {activePage === 'account-fellow-travelers' ? <FamilyRelationships
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
      /> : null}
      {activePage === 'account-packing-list' ? <PackingListTable
        backendUrl={backendUrl}
        headers={headers}
        variant="user"
        title="Personal packing list"
      /> : null}
      {activePage === 'account-travel-profile' ? <AccountTraits
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
      /> : null}
      <View style={[localStyles.legalSection, { borderTopColor: theme.colors.border }]}>
        <Text style={[localStyles.legalTitle, { color: theme.colors.textMuted }]}>Legal</Text>
        <View style={localStyles.legalLinks}>
          <Pressable onPress={() => {
            const baseUrl = Platform.OS === 'web' ? window.location.origin : backendUrl.replace(/\/api$/, '');
            void Linking.openURL(`${baseUrl}/privacy.html`);
          }}>
            <Text style={[localStyles.legalLink, { color: theme.colors.link }]}>Privacy Policy</Text>
          </Pressable>
          <Text style={{ color: theme.colors.textMuted }}> • </Text>
          <Pressable onPress={() => {
            const baseUrl = Platform.OS === 'web' ? window.location.origin : backendUrl.replace(/\/api$/, '');
            void Linking.openURL(`${baseUrl}/terms.html`);
          }}>
            <Text style={[localStyles.legalLink, { color: theme.colors.link }]}>Terms of Service</Text>
          </Pressable>
        </View>
        <Text style={[localStyles.copyright, { color: theme.colors.textMuted }]}>&copy; 2026 WanderBunnies Travel</Text>
      </View>
    </View>
  );
};

const localStyles = StyleSheet.create({
  pageHeader: { gap: 8, marginBottom: 16 },
  pageTitle: { fontSize: 26, fontWeight: '700' },
  linksSection: { marginVertical: 16, gap: 10 },
  linkGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  linkCard: { borderWidth: 1, borderRadius: 8, padding: 14, minWidth: 220, flex: 1, gap: 5 },
  linkTitle: { fontSize: 17, fontWeight: '700' },
  linkDescription: { fontSize: 13, lineHeight: 18 },
  legalSection: { marginTop: 24, paddingVertical: 20, borderTopWidth: 1, alignItems: 'center', gap: 8 },
  legalTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  legalLinks: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legalLink: { fontSize: 14, fontWeight: '600' },
  copyright: { fontSize: 12, marginTop: 4 },
});

export default AccountTab;
