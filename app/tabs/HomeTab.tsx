import IconText from '../components/IconText';
import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Modal from '../components/KeyboardAwareModal';
import { computeTripDays } from '../utils/createTripWizard';
import { formatDateLong } from '../utils/formatDateLong';
import { FollowedTrip } from './follow';
import Skeleton from '../components/Skeleton';
import { useImageSource } from '../utils/imageSource';
import BannerPicturePicker from '../components/BannerPicturePicker';
import DestinationPlaceholderCard from '../components/DestinationPlaceholderCard';
import Icon, { type IconName } from '../components/Icon';

type Trip = {
  id: string;
  name: string;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  durationDays?: number | null;
  currency?: string | null;
  createdAt?: string;
};

type HomeTabProps = {
  readOnly?: boolean;
  backendUrl: string;
  headers: Record<string, string>;
  activeTripId: string | null;
  trips: Trip[];
  followedTrips: FollowedTrip[];
  userRole?: 'user' | 'admin';
  // Drives the Ingest tile's visibility below — Free users don't get it, Premium/Pro do.
  // Purely a UX gate; every ingestion endpoint re-checks tier server-side independently.
  userTier?: string;
  activeTripOverride?: Trip | null;
  styles: Record<string, any>;
  onSelectTrip: (tripId: string) => void;
  onSelectFollowedTrip: (tripId: string) => void;
  onNavigate: (page: string) => void;
  onDeleteTrip?: (trip: { id: string; name: string }) => void;
  disabledPages?: Set<string>;
  hiddenPages?: Set<string>;
  // Kill switch for the designed gradient placeholder shown in place of a
  // missing cover photo (implementation-plan-ux-remediation.md, Initiative B).
  // Defaults to `true`; `false` reverts to the plain empty fallback tile.
  featureCoverPhotoFallbackV2?: boolean;
};

const formatTripDuration = (trip?: Trip | null): string | null => {
  if (!trip) return null;
  const computed = computeTripDays(trip.startDate ?? null, trip.endDate ?? null);
  const days = computed ?? trip.durationDays ?? null;
  if (!days) return null;
  return `${days}-day adventure in`;
};

const HomeTab: React.FC<HomeTabProps> = ({
  readOnly = false,
  backendUrl,
  headers,
  activeTripId,
  trips,
  followedTrips,
  userRole = 'user',
  userTier = 'free',
  activeTripOverride,
  styles,
  onSelectTrip,
  onSelectFollowedTrip,
  onNavigate,
  onDeleteTrip,
  disabledPages,
  hiddenPages,
  featureCoverPhotoFallbackV2 = true,
}) => {
  const _styleTheme = useStyleTheme();
  const { width: viewportWidth } = useWindowDimensions();
  const isPhoneLayout = viewportWidth < 680;
  const isCompactLayout = viewportWidth < 520;
  const heroHeight = Math.max(200, Math.min(320, viewportWidth * 0.42));
  const [picturePickerOpen, setPicturePickerOpen] = useState(false);
  const [customPicture, setCustomPicture] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setCustomPicture(null);
    if (activeTripId) fetch(`${backendUrl}/api/trips/${activeTripId}/blog?limit=1`, { headers }).then(async (res) => {
      if (!res.ok) return;
      const data = await res.json();
      if (active) setCustomPicture(data.tripCover?.primaryUrl || data.tripCover?.thumbnailUrl || null);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [activeTripId, backendUrl, headers]);
  const [heroImage, setHeroImage] = useState<string | null>(null);
  const [heroLoading, setHeroLoading] = useState<boolean>(false);
  const [showTripPicker, setShowTripPicker] = useState(false);
  const [showNoTripsDialog, setShowNoTripsDialog] = useState(false);


  const activeTrip = useMemo(
    () => activeTripOverride ?? trips.find((t) => t.id === activeTripId) ?? null,
    [activeTripOverride, trips, activeTripId]
  );

  const sortedTrips = useMemo(() => {
    const active = activeTripId ? trips.find((t) => t.id === activeTripId) ?? null : null;
    const rest = trips.filter((t) => t.id !== activeTripId);
    const noStart = rest.filter((t) => !t.startDate);
    const withStart = rest.filter((t) => t.startDate);
    noStart.sort((a, b) => a.name.localeCompare(b.name));
    withStart.sort((a, b) => {
      const aTime = new Date(a.startDate as string).getTime();
      const bTime = new Date(b.startDate as string).getTime();
      if (aTime !== bTime) return aTime - bTime;
      return a.name.localeCompare(b.name);
    });
    return active ? [active, ...noStart, ...withStart] : [...noStart, ...withStart];
  }, [trips, activeTripId]);

  const heroFetchKey = activeTrip
    ? `${activeTrip.id}:${activeTrip.destination ?? ''}:${activeTrip.name ?? ''}`
    : null;

  useEffect(() => {
    let isMounted = true;
    const loadHero = async () => {
      if (!heroFetchKey || !activeTrip) {
        if (isMounted) {
          setHeroImage(null);
          setHeroLoading(false);
        }
        return;
      }
      if (isMounted) {
        setHeroLoading(true);
      }
      const location = activeTrip.destination || activeTrip.name || 'travel';
      try {
        const res = await fetch(
          `${backendUrl}/api/itinerary/images?location=${encodeURIComponent(location)}&day=home`,
          { headers }
        );
        if (!res.ok) {
          if (isMounted) setHeroLoading(false);
          return;
        }
        const data = await res.json();
        if (isMounted) {
          setHeroImage(data?.url ?? null);
          setHeroLoading(false);
        }
      } catch {
        if (isMounted) {
          setHeroImage(null);
          setHeroLoading(false);
        }
      }
    };
    loadHero();
    return () => {
      isMounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroFetchKey, backendUrl]);

  const heroImageSource = useImageSource(customPicture || heroImage);

  const heroSubtitle = formatTripDuration(activeTrip);
  const heroTitle = activeTrip?.destination || activeTrip?.name || 'Select a trip';
  const navIconColor = (StyleSheet.flatten(styles.homeNavLabel)?.color as string | undefined) ?? themeStyle('tabs_HomeTab_19', {  }, _styleTheme);
  const regularUserHiddenHomePages = new Set(['trips', 'account', 'following']);
  // Ingest (manual upload + forwarded-mailbox import) is Premium/Pro only, same as the
  // server-side tier check in ingestionRoutes.ts/ingestionWebhookRoutes.ts — Free users
  // don't get the tile. Gmail import specifically stays hidden for everyone regardless of
  // tier via feature_ingest_gmail_import (see ingestion.tsx's config.features.gmailImport)
  // since it's untested; remove that flag check once Gmail import is ready to ship.
  const canAccessIngest = userRole === 'admin' || userTier === 'premium' || userTier === 'pro';
  const hasTripsToSelect = sortedTrips.length > 0 || followedTrips.length > 0;

  const navItemDefs: Array<{ key: string; label: string; icon: IconName }> = [
    { key: 'overview', label: 'Itinerary', icon: 'itinerary' },
    { key: 'blog', label: 'Trip Blog', icon: 'blog' },
    { key: 'flights', label: 'Flights', icon: 'flight' },
    { key: 'lodging', label: 'Lodging', icon: 'lodging' },
    { key: 'tours', label: 'Activities', icon: 'activity' },
    { key: 'ground-transfers', label: 'Ground Transfers', icon: 'transfer' },
    { key: 'car', label: 'Car Rentals', icon: 'car' },
    { key: 'expenses', label: 'Daily Expenses', icon: 'expense' },
    { key: 'cost', label: 'Cost Report', icon: 'report' },
    { key: 'packing', label: 'Packing', icon: 'packing' },
    { key: 'ingest', label: 'Import Travel Confirmations', icon: 'import' },
  ];
  const navItems = navItemDefs
    .filter((item) => userRole === 'admin' || !regularUserHiddenHomePages.has(item.key))
    .filter((item) => item.key !== 'ingest' || canAccessIngest)
    .filter((item) => !hiddenPages?.has(item.key));


  return (
    <View style={[styles.card, themeStyle('tabs_HomeTab_1', {  }, _styleTheme)]}>
      <ScrollView
        style={themeStyle('tabs_HomeTab_2', {  }, _styleTheme)}
        contentContainerStyle={[styles.homeScrollContent, themeStyle('tabs_HomeTab_3', {  }, _styleTheme)]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        nestedScrollEnabled
        contentInsetAdjustmentBehavior="automatic"
      >
        <Pressable
          testID="home-hero-card"
          style={({ pressed }: { pressed: boolean }) => [
            styles.homeHeroCard,
            themeStyle('tabs_HomeTab_7', { heroHeight: heroHeight }, _styleTheme),
            pressed && styles.homeHeroCardPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Change trip picture"
          disabled={readOnly || !activeTripId}
          onPress={() => setPicturePickerOpen(true)}
        >
          {customPicture || heroImage ? (
            <Image style={styles.homeHeroImage} source={heroImageSource} resizeMode="cover" />
          ) : heroLoading ? (
            <Skeleton style={styles.homeHeroImage} testID="home-hero-skeleton" />
          ) : featureCoverPhotoFallbackV2 ? (
            <DestinationPlaceholderCard title={heroTitle} style={styles.homeHeroFallback} testID="home-hero-placeholder" showLabel={false} />
          ) : (
            <View style={styles.homeHeroFallback} testID="home-hero-fallback-legacy" />
          )}
          <View style={styles.homeHeroOverlay} />
          <View
            style={[
              styles.homeHeroTextWrap,
              isCompactLayout && themeStyle('tabs_HomeTab_8', {  }, _styleTheme),
            ]}
          >
            {heroSubtitle ? (
              <Text style={[styles.homeHeroSubtitle, isCompactLayout && themeStyle('tabs_HomeTab_9', {  }, _styleTheme)]}>{heroSubtitle}</Text>
            ) : null}
            <Text
              style={[styles.homeHeroTitle, isCompactLayout && themeStyle('tabs_HomeTab_10', {  }, _styleTheme)]}
              numberOfLines={isCompactLayout ? 3 : 2}
              ellipsizeMode="tail"
            >
              {heroTitle}
            </Text>
          </View>
          {!readOnly && activeTripId ? <View
            style={[styles.homeHeroChangeTripBadge, themeStyle('tabs_HomeTab_11', {  }, _styleTheme), isCompactLayout && themeStyle('tabs_HomeTab_12', {  }, _styleTheme)]}
          >
            <Text style={styles.homeHeroChangeTripText}>Click to Change Picture</Text>
          </View> : null}
        </Pressable>

        <View style={styles.homeNavList}>
          <Pressable accessibilityRole="button" testID="home-all-trips" onPress={() => onNavigate('all-trips')} style={styles.homeNavButton}>
            <View style={styles.homeNavIcon}><Icon name="trips" color={navIconColor} size={22} /></View>
            <Text style={styles.homeNavLabel}>Change or Create Trip</Text>
            <Text style={styles.homeNavArrow}>{'>'}</Text>
          </Pressable>
          {navItems.map((item) => (
            <Pressable
              key={item.key}
              testID={`home-nav-${item.key}`}
              style={({ pressed }: { pressed: boolean }) => [
                styles.homeNavButton,
                disabledPages?.has(item.key) && styles.homeNavButtonDisabled,
                pressed && !disabledPages?.has(item.key) && styles.homeNavButtonPressed,
              ]}
              onPress={() => onNavigate(item.key)}
              disabled={disabledPages?.has(item.key)}
            >
              <View style={styles.homeNavIcon}><Icon name={item.icon} color={navIconColor} size={22} /></View>
              <Text style={styles.homeNavLabel}>{item.label}</Text>
              <Text style={styles.homeNavArrow}>{'>'}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {showTripPicker ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setShowTripPicker(false)}>
          <View style={styles.homeModalOverlay} testID="home-trip-modal">
            <View style={styles.homeModalCard}>
              <View style={styles.homeModalHeader}>
                <Text style={styles.homeModalTitle}>Select a trip</Text>
                <Pressable
                  onPress={() => setShowTripPicker(false)}
                  style={({ pressed }: { pressed: boolean }) => [styles.homeModalClose, pressed && styles.homeModalClosePressed]}
                >
                  <IconText style={styles.homeModalCloseText}>✕</IconText>
                </Pressable>
              </View>
              <ScrollView
                style={styles.homeModalList}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {sortedTrips.map((trip, idx) => (
                  <Pressable
                    key={trip.id}
                    testID={`home-trip-row-${trip.id}`}
                    style={({ pressed }: { pressed: boolean }) => [
                      styles.homeModalRow,
                      idx === 0 && trip.id === activeTripId && styles.homeModalRowActive,
                      pressed && styles.homeModalRowPressed,
                    ]}
                    onPress={() => {
                      onSelectTrip(trip.id);
                      setShowTripPicker(false);
                    }}
                  >
                    <View style={styles.homeModalRowText}>
                      <Text style={styles.homeModalRowTitle}>{trip.name}</Text>
                      {trip.startDate ? (
                        <Text style={styles.homeModalRowMeta}>{formatDateLong(trip.startDate)}</Text>
                      ) : (
                        <Text style={styles.homeModalRowMeta}>No start date</Text>
                      )}
                    </View>
                    {trip.id === activeTripId ? <Text style={styles.homeModalActiveBadge}>Active</Text> : null}
                    {onDeleteTrip ? (
                      <Pressable
                        testID={`home-trip-row-delete-${trip.id}`}
                        hitSlop={8}
                        style={({ pressed }: { pressed: boolean }) => [
                          styles.homeModalRowDelete,
                          pressed && styles.homeModalRowDeletePressed,
                        ]}
                        onPress={(e: any) => {
                          e?.stopPropagation?.();
                          onDeleteTrip({ id: trip.id, name: trip.name });
                        }}
                      >
                        <IconText style={styles.homeModalRowDeleteText}>🗑 Delete</IconText>
                      </Pressable>
                    ) : null}
                  </Pressable>
                ))}
                {followedTrips.length ? (
                  <View>
                    <Text style={styles.homeModalTitle}>Followed Trips</Text>
                    {followedTrips.map((trip) => (
                      <Pressable
                        key={`followed-${trip.tripId}`}
                        testID={`home-followed-trip-row-${trip.tripId}`}
                        style={({ pressed }: { pressed: boolean }) => [
                          styles.homeModalRow,
                          pressed && styles.homeModalRowPressed,
                        ]}
                        onPress={() => {
                          onSelectFollowedTrip(trip.tripId);
                          setShowTripPicker(false);
                        }}
                      >
                        <View style={styles.homeModalRowText}>
                          <Text style={styles.homeModalRowTitle}>{trip.tripName}</Text>
                          <Text style={styles.homeModalRowMeta}>{trip.destination || 'Followed trip'}</Text>
                        </View>
                        <Text style={styles.homeModalActiveBadge}>Following</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}

      {showNoTripsDialog ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setShowNoTripsDialog(false)}>
          <View style={styles.homeModalOverlay} testID="home-no-trips-dialog">
            <View style={styles.homeModalCard}>
              <View style={styles.homeModalHeader}>
                <Text style={styles.homeModalTitle}>Create a trip first</Text>
              </View>
              <Text style={styles.homeModalRowMeta}>A trip needs to be created before you can select one.</Text>
              <View style={[styles.row, themeStyle('tabs_HomeTab_13', {  }, _styleTheme)]}>
                <Pressable
                  testID="home-no-trips-create"
                  style={({ pressed }: { pressed: boolean }) => [
                    styles.button,
                    styles.smallButton,
                    pressed && styles.homeNavButtonPressed,
                  ]}
                  onPress={() => {
                    setShowNoTripsDialog(false);
                    onNavigate('create-trip');
                  }}
                >
                  <Text style={styles.buttonText}>Create Trip</Text>
                </Pressable>
                <Pressable
                  testID="home-no-trips-ok"
                  style={({ pressed }: { pressed: boolean }) => [
                    styles.button,
                    styles.smallButton,
                    themeStyle('tabs_HomeTab_14', {  }, _styleTheme),
                    pressed && styles.homeNavButtonPressed,
                  ]}
                  onPress={() => setShowNoTripsDialog(false)}
                >
                  <Text style={styles.buttonText}>OK</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}

      {activeTripId && !readOnly ? <BannerPicturePicker visible={picturePickerOpen} backendUrl={backendUrl} headers={headers} tripId={activeTripId} styles={styles} onClose={() => setPicturePickerOpen(false)} onSaved={setCustomPicture} /> : null}
    </View>
  );
};

// Memoized so AppShell re-renders (presence-driven, polling-driven, etc.)
// don't cascade into a full HomeTab re-render. All props from AppShell are
// already stable (useState arrays, useCallback handlers, useMemo for
// disabledPages/hiddenPages), so a default shallow compare is enough.
export default React.memo(HomeTab);
