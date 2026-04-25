import React, { useEffect, useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { computeTripDays } from '../utils/createTripWizard';
import { formatDateLong } from '../utils/formatDateLong';
import { FollowedTrip } from './follow';
import Skeleton from '../components/Skeleton';
import { useImageSource } from '../utils/imageSource';

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
  backendUrl: string;
  headers: Record<string, string>;
  activeTripId: string | null;
  trips: Trip[];
  followedTrips: FollowedTrip[];
  userRole?: 'user' | 'admin';
  activeTripOverride?: Trip | null;
  styles: Record<string, any>;
  onSelectTrip: (tripId: string) => void;
  onSelectFollowedTrip: (tripId: string) => void;
  onNavigate: (page: string) => void;
  onFollowTrip: (inviteCode: string) => Promise<string | null>;
  disabledPages?: Set<string>;
  hiddenPages?: Set<string>;
};

const formatTripDuration = (trip?: Trip | null): string | null => {
  if (!trip) return null;
  const computed = computeTripDays(trip.startDate ?? null, trip.endDate ?? null);
  const days = computed ?? trip.durationDays ?? null;
  if (!days) return null;
  return `${days}-day adventure in`;
};

const HomeTab: React.FC<HomeTabProps> = ({
  backendUrl,
  headers,
  activeTripId,
  trips,
  followedTrips,
  userRole = 'user',
  activeTripOverride,
  styles,
  onSelectTrip,
  onSelectFollowedTrip,
  onNavigate,
  onFollowTrip,
  disabledPages,
  hiddenPages,
}) => {
  const [heroImage, setHeroImage] = useState<string | null>(null);
  const [heroLoading, setHeroLoading] = useState<boolean>(false);
  const [showTripPicker, setShowTripPicker] = useState(false);
  const [showNoTripsDialog, setShowNoTripsDialog] = useState(false);
  const [showFollowDialog, setShowFollowDialog] = useState(false);
  const [followCodeInput, setFollowCodeInput] = useState('');
  const [followCodeError, setFollowCodeError] = useState('');
  const [followSubmitting, setFollowSubmitting] = useState(false);

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
  }, [activeTrip, backendUrl, headers]);

  const heroImageSource = useImageSource(heroImage);

  const heroSubtitle = formatTripDuration(activeTrip);
  const heroTitle = activeTrip?.destination || activeTrip?.name || 'Select a trip';
  const regularUserHiddenHomePages = new Set(['itinerary', 'trips', 'account', 'following']);
  const hasTripsToSelect = sortedTrips.length > 0 || followedTrips.length > 0;

  const navItems = [
    { key: 'overview', label: 'Overview', icon: '🧭' },
    { key: 'flights', label: 'Transfers', icon: '✈️' },
    { key: 'lodging', label: 'Lodging', icon: '🏨' },
    { key: 'tours', label: 'Activities', icon: '🎟️' },
    { key: 'expenses', label: 'Daily Expenses', icon: '🧾' },
    { key: 'car', label: 'Car Rentals', icon: '🚗' },
    { key: 'cost', label: 'Cost Report', icon: '💵' },
    { key: 'ingest', label: 'Ingest', icon: '📥' },
  ]
    .filter((item) => userRole === 'admin' || !regularUserHiddenHomePages.has(item.key))
    .filter((item) => !hiddenPages?.has(item.key));

  const submitFollowCode = async () => {
    const code = followCodeInput.trim();
    if (!code) {
      setFollowCodeError('Enter a follow code');
      return;
    }
    setFollowSubmitting(true);
    setFollowCodeError('');
    const error = await onFollowTrip(code);
    setFollowSubmitting(false);
    if (error) {
      setFollowCodeError(error);
      return;
    }
    setFollowCodeInput('');
    setShowFollowDialog(false);
  };

  return (
    <View style={[styles.card, { flex: 1, minHeight: 0 }]}>
      <ScrollView
        style={{ flex: 1, minHeight: 0 }}
        contentContainerStyle={[styles.homeScrollContent, { flexGrow: 1 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.row, { alignItems: 'center', justifyContent: 'space-between', gap: 8 }]}>
          <Text style={styles.homeTitle}>Your trip</Text>
          <View style={[styles.row, { alignItems: 'center', gap: 8 }]}>
            {!hiddenPages?.has('create-trip') ? (
              <Pressable
                testID="home-create-trip-button"
                style={({ pressed }: { pressed: boolean }) => [
                  styles.button,
                  styles.smallButton,
                  pressed && styles.homeNavButtonPressed,
                ]}
                onPress={() => onNavigate('create-trip')}
              >
                <Text style={styles.buttonText}>+ Create Trip</Text>
              </Pressable>
            ) : null}
            {!hiddenPages?.has('follow') ? (
              <Pressable
                testID="home-follow-trip-button"
                style={({ pressed }: { pressed: boolean }) => [
                  styles.button,
                  styles.smallButton,
                  pressed && styles.homeNavButtonPressed,
                ]}
                onPress={() => {
                  setFollowCodeError('');
                  setShowFollowDialog(true);
                }}
              >
                <Text style={styles.buttonText}>Follow Trip</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <Pressable
          testID="home-hero-card"
          style={({ pressed }: { pressed: boolean }) => [styles.homeHeroCard, pressed && styles.homeHeroCardPressed]}
          onPress={() => {
            if (hasTripsToSelect) {
              setShowTripPicker(true);
              return;
            }
            setShowNoTripsDialog(true);
          }}
        >
          {heroImage ? (
            <Image style={styles.homeHeroImage} source={heroImageSource} resizeMode="cover" />
          ) : heroLoading ? (
            <Skeleton style={styles.homeHeroImage} testID="home-hero-skeleton" />
          ) : (
            <View style={styles.homeHeroFallback} />
          )}
          <View style={styles.homeHeroOverlay} />
          <View style={styles.homeHeroTextWrap}>
            {heroSubtitle ? <Text style={styles.homeHeroSubtitle}>{heroSubtitle}</Text> : null}
            <Text style={styles.homeHeroTitle}>{heroTitle}</Text>
          </View>
        </Pressable>

        <View style={styles.homeNavList}>
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
              <Text style={styles.homeNavIcon}>{item.icon}</Text>
              <Text style={styles.homeNavLabel}>{item.label}</Text>
              <Text style={styles.homeNavArrow}>{'>'}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {showTripPicker ? (
        <Modal transparent animationType="fade" visible>
          <View style={styles.homeModalOverlay} testID="home-trip-modal">
            <View style={styles.homeModalCard}>
              <View style={styles.homeModalHeader}>
                <Text style={styles.homeModalTitle}>Select a trip</Text>
                <Pressable
                  onPress={() => setShowTripPicker(false)}
                  style={({ pressed }: { pressed: boolean }) => [styles.homeModalClose, pressed && styles.homeModalClosePressed]}
                >
                  <Text style={styles.homeModalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.homeModalList}>
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
        <Modal transparent animationType="fade" visible>
          <View style={styles.homeModalOverlay} testID="home-no-trips-dialog">
            <View style={styles.homeModalCard}>
              <View style={styles.homeModalHeader}>
                <Text style={styles.homeModalTitle}>Create a trip first</Text>
              </View>
              <Text style={styles.homeModalRowMeta}>A trip needs to be created before you can select one.</Text>
              <View style={[styles.row, { justifyContent: 'flex-end', marginTop: 16 }]}>
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
                    { marginLeft: 8 },
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

      {showFollowDialog ? (
        <Modal transparent animationType="fade" visible>
          <View style={styles.homeModalOverlay} testID="home-follow-dialog">
            <View style={styles.homeModalCard}>
              <View style={styles.homeModalHeader}>
                <Text style={styles.homeModalTitle}>Follow Trip</Text>
                <Pressable
                  onPress={() => setShowFollowDialog(false)}
                  style={({ pressed }: { pressed: boolean }) => [styles.homeModalClose, pressed && styles.homeModalClosePressed]}
                >
                  <Text style={styles.homeModalCloseText}>✕</Text>
                </Pressable>
              </View>
              <Text style={styles.homeModalRowMeta}>Enter a follow code to add a shared trip.</Text>
              <TextInput
                testID="home-follow-code-input"
                style={[styles.input, { marginTop: 12 }]}
                placeholder="Follow code"
                autoCapitalize="characters"
                autoCorrect={false}
                value={followCodeInput}
                onChangeText={(text: string) => {
                  setFollowCodeInput(text);
                  if (followCodeError) setFollowCodeError('');
                }}
              />
              {followCodeError ? <Text style={[styles.homeModalRowMeta, { marginTop: 8 }]}>{followCodeError}</Text> : null}
              <View style={[styles.row, { justifyContent: 'flex-end', marginTop: 16 }]}>
                <Pressable
                  testID="home-follow-cancel"
                  style={({ pressed }: { pressed: boolean }) => [
                    styles.button,
                    styles.smallButton,
                    styles.dangerButton,
                    pressed && styles.homeNavButtonPressed,
                  ]}
                  onPress={() => setShowFollowDialog(false)}
                >
                  <Text style={styles.dangerButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  testID="home-follow-submit"
                  style={({ pressed }: { pressed: boolean }) => [
                    styles.button,
                    styles.smallButton,
                    { marginLeft: 8 },
                    pressed && styles.homeNavButtonPressed,
                  ]}
                  onPress={() => void submitFollowCode()}
                >
                  <Text style={styles.buttonText}>{followSubmitting ? 'Following...' : 'Follow Trip'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
};

export default HomeTab;
