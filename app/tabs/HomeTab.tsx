import React, { useEffect, useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { computeTripDays } from '../utils/createTripWizard';
import { formatDateLong } from '../utils/formatDateLong';

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
  styles: Record<string, any>;
  onSelectTrip: (tripId: string) => void;
  onNavigate: (page: string) => void;
  disabledPages?: Set<string>;
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
  styles,
  onSelectTrip,
  onNavigate,
  disabledPages,
}) => {
  const [heroImage, setHeroImage] = useState<string | null>(null);
  const [showTripPicker, setShowTripPicker] = useState(false);

  const activeTrip = useMemo(
    () => trips.find((t) => t.id === activeTripId) ?? null,
    [trips, activeTripId]
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

  useEffect(() => {
    let isMounted = true;
    const loadHero = async () => {
      if (!activeTrip) {
        if (isMounted) setHeroImage(null);
        return;
      }
      const location = activeTrip.destination || activeTrip.name || 'travel';
      try {
        const res = await fetch(
          `${backendUrl}/api/itinerary/images?location=${encodeURIComponent(location)}&day=home`,
          { headers }
        );
        if (!res.ok) {
          if (isMounted) setHeroImage(null);
          return;
        }
        const data = await res.json();
        if (isMounted) setHeroImage(data?.url ?? null);
      } catch {
        if (isMounted) setHeroImage(null);
      }
    };
    loadHero();
    return () => {
      isMounted = false;
    };
  }, [activeTrip, backendUrl, headers]);

  const heroSubtitle = formatTripDuration(activeTrip);
  const heroTitle = activeTrip?.destination || activeTrip?.name || 'Select a trip';

  const navItems = [
    { key: 'overview', label: 'Overview', icon: '🧭' },
    { key: 'itinerary', label: 'Create Itinerary', icon: '🧾' },
    { key: 'flights', label: 'Transfers', icon: '✈️' },
    { key: 'lodging', label: 'Lodging', icon: '🏨' },
        { key: 'tours', label: 'Activities', icon: '🎟️' },
        { key: 'expenses', label: 'Daily Expenses', icon: '🧾' },
        { key: 'car', label: 'Car Rentals', icon: '🚗' },
    { key: 'cost', label: 'Cost Report', icon: '💵' },
    { key: 'ledger', label: 'Ledger', icon: '📒' },
    { key: 'trips', label: 'Trips', icon: '🧳' },
    { key: 'create-trip', label: 'Create Trip', icon: '➕' },
    { key: 'account', label: 'Account', icon: '👤' },
    { key: 'follow', label: 'Follow Trip', icon: '🔗' },
    { key: 'following', label: 'Following Trips', icon: '👀' },
  ];

  return (
    <View style={styles.card}>
      <ScrollView contentContainerStyle={styles.homeScrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.homeTitle}>Your trip</Text>
        <Pressable
          testID="home-hero-card"
          style={({ pressed }: { pressed: boolean }) => [styles.homeHeroCard, pressed && styles.homeHeroCardPressed]}
          onPress={() => setShowTripPicker(true)}
        >
          {heroImage ? (
            <Image style={styles.homeHeroImage} source={{ uri: heroImage }} resizeMode="cover" />
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
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
};

export default HomeTab;
