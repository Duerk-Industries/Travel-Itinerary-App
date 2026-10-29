import { resolveComponentTheme as resolveStyleTheme, themeStyle, getAppTheme as getStyleTheme, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import AddToCalendarButton from './AddToCalendarButton';
import { lodgingCalendarEvent } from '../utils/calendarEvents';
import React, { memo, useEffect, useMemo, useState } from 'react';
import { StyleSheet, ScrollView, Text, View, TouchableOpacity, useWindowDimensions, Image, Platform } from 'react-native';
import { type Lodging, fetchPlaceDetailsApi, type PlaceDetailsPayload } from '../tabs/lodging';
import { formatDateLong } from '../utils/formatDateLong';
import { buildStaticMapUrl } from '../utils/googleMaps';
import { LEGACY_ITINERARY_STATUS, normalizeItineraryStatus } from '../utils/itineraryStatus';
import { useImageSource } from '../utils/imageSource';

import TripDayMap from './TripDayMap';
import DialogShell from './DialogShell';

type DetailRow = {
  label: string;
  value: any;
  action?: () => void;
};

type LodgingDetailsDialogProps = {
  visible: boolean;
  lodging: Lodging | null;
  attendees: Array<{
    id: string;
    guestName?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    userEmail?: string;
    status?: string;
  }>;
  backendUrl: string;
  requestHeaders: Record<string, string>;
  styles: Record<string, any>;
  theme?: AppTheme;
  payerName: (id: string) => string;
  travelerName?: (id: string) => string;
  readOnly?: boolean;
  onClose: () => void;
  onEdit: (lodging: Lodging) => void;
  onDelete: (lodging: Lodging) => void;
  onOpenMap: (address: string) => void;
  testID?: string;
};

const LodgingDetailsDialogComponent: React.FC<LodgingDetailsDialogProps> = ({
  visible,
  lodging,
  attendees = [],
  backendUrl,
  requestHeaders,
  styles,
  theme: _providedTheme,
  payerName,
  travelerName,
  readOnly = false,
  onClose,
  onEdit,
  onDelete,
  onOpenMap,
  testID,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const { width } = useWindowDimensions();
  const isCompact = width < 520;
  const imageHeight = Math.max(170, Math.min(260, width * 0.52));
  const mapHeight = Math.max(150, Math.min(220, width * 0.45));
  const detailStyles = useMemo(() => buildDetailStyles(theme), [theme]);

  const [placeDetails, setPlaceDetails] = useState<PlaceDetailsPayload | null>(null);
  const [placeDetailsStatus, setPlaceDetailsStatus] = useState<'idle' | 'loading' | 'done'>('idle');

  useEffect(() => {
    let isMounted = true;
    if (!visible || !lodging?.placeId) {
      setPlaceDetails(null);
      setPlaceDetailsStatus('idle');
      return () => undefined;
    }
    setPlaceDetailsStatus('loading');
    fetchPlaceDetailsApi(backendUrl, requestHeaders, lodging.placeId)
      .then((data) => {
        if (!isMounted) return;
        setPlaceDetails(data);
        setPlaceDetailsStatus('done');
      })
      .catch(() => {
        if (!isMounted) return;
        setPlaceDetails(null);
        setPlaceDetailsStatus('done');
      });
    return () => {
      isMounted = false;
    };
  }, [backendUrl, lodging?.placeId, requestHeaders, visible]);

  const photoUrl = placeDetails?.details?.photos?.[0]?.photoUri;
  const imageUrl = lodging?.imageUrl || photoUrl;
  const mapImageUrl = lodging?.address ? `${backendUrl}/api/maps/static?lodgingId=${encodeURIComponent(lodging.id)}` : '';
  const imageSource = useImageSource(imageUrl);
  // React Native's Image supports request headers, allowing the authenticated
  // server proxy to protect the Google Maps key while still rendering bytes
  // directly as an image.
  const mapImageSource = useMemo(
    () => (mapImageUrl ? { uri: mapImageUrl, headers: requestHeaders } : undefined),
    [mapImageUrl, requestHeaders]
  );

  if (!visible || !lodging) return null;
  const dateRange = `${lodging.checkInDate ? formatDateLong(lodging.checkInDate) : 'TBD'}${lodging.checkOutDate ? ` – ${formatDateLong(lodging.checkOutDate)}` : ''}`;
  const travelerIds =
    Array.isArray(lodging.travelerIds) && lodging.travelerIds.length
      ? lodging.travelerIds
      : Array.isArray(lodging.paidBy)
        ? lodging.paidBy
        : [];

  const resolveTravelerName = travelerName ?? payerName;
  const travelersLabel = travelerIds.length
    ? travelerIds
        .map((id) => {
          const name = resolveTravelerName(id);
          const attendee = attendees.find((a) => a.id === id);
          const guestName = attendee?.guestName;
          const firstName = attendee?.firstName;
          const lastName = attendee?.lastName;
          if (firstName || lastName) return `${firstName ?? ''} ${lastName ?? ''}`.trim();
          return name || guestName || id;
        })
        .join(', ')
    : 'Not set';
  const totalCostLabel = lodging.totalCost ? `$${lodging.totalCost}` : 'Not set';
  const placeDetailsRows = useMemo<DetailRow[]>(() => {
    if (!placeDetails?.details) return [];
    const details = placeDetails.details as any;
    const phone = details.internationalPhoneNumber || details.nationalPhoneNumber;
    const website = details.websiteUri;
    const rating = typeof details.rating === 'number' ? `${details.rating} (${details.userRatingCount ?? 0})` : null;
    const hours = Array.isArray(details.regularOpeningHours?.weekdayDescriptions)
      ? details.regularOpeningHours.weekdayDescriptions.join(' • ')
      : null;

    const rows: DetailRow[] = [];
    if (phone) rows.push({ label: 'Phone', value: phone });
    if (website) rows.push({ label: 'Website', value: website });
    if (rating) rows.push({ label: 'Rating', value: rating });
    if (hours) rows.push({ label: 'Hours', value: hours });
    return rows;
  }, [placeDetails]);

  return (
    <DialogShell
      visible={visible}
      title={`Lodging details: ${lodging.name || 'lodging'}`}
      styles={styles}
      onClose={onClose}
      testID={testID}
      cardStyle={[styles.modalCard, detailStyles.detailCard, isCompact && themeStyle('components_LodgingDetailsDialog_1', {  }, (theme ?? _styleTheme))]}
      showTitle={false}
    >
        <ScrollView
          style={themeStyle('components_LodgingDetailsDialog_2', {  }, (theme ?? _styleTheme))}
          contentContainerStyle={themeStyle('components_LodgingDetailsDialog_3', {  }, (theme ?? _styleTheme))}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          nestedScrollEnabled
          contentInsetAdjustmentBehavior="automatic"
        >
          <View style={[detailStyles.imageWrap, themeStyle('components_LodgingDetailsDialog_4', { imageHeight: imageHeight }, (theme ?? _styleTheme))]}>
            {imageUrl ? (
              <Image source={imageSource} style={detailStyles.image} resizeMode="cover" />
            ) : (
              <View style={detailStyles.imageFallback}>
                <Text style={detailStyles.mutedText}>No photo available</Text>
              </View>
            )}
            <TouchableOpacity
              style={detailStyles.closeButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close lodging details"
            >
              <Text style={detailStyles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={detailStyles.headerRow}>
            <View style={detailStyles.headerMeta}>
              <Text style={detailStyles.title} accessibilityRole="header">{lodging.name}</Text>
              <Text style={[detailStyles.mutedText, themeStyle('components_LodgingDetailsDialog_5', {  }, (theme ?? _styleTheme))]} numberOfLines={2}>
                {lodging.address || 'Address not available'}
              </Text>
            </View>
            <View style={detailStyles.statusBadge}>
              <Text style={detailStyles.statusText}>{normalizeItineraryStatus(lodging.status, LEGACY_ITINERARY_STATUS)}</Text>
            </View>
          </View>
          <View style={detailStyles.detailList}>
            {(
              [
                { label: 'Check-in', value: lodging.checkInDate ? formatDateLong(lodging.checkInDate) : 'TBD' },
                { label: 'Check-out', value: lodging.checkOutDate ? formatDateLong(lodging.checkOutDate) : 'TBD' },
                { label: 'Rooms', value: lodging.rooms || '1' },
                { label: 'Status', value: normalizeItineraryStatus(lodging.status, LEGACY_ITINERARY_STATUS) },
                { label: 'Refund By', value: lodging.refundBy ? formatDateLong(lodging.refundBy) : 'N/A' },
                {
                  label: 'Address',
                  value: lodging.address || 'Not provided',
                  action: lodging.address ? () => onOpenMap(lodging.address) : undefined,
                },
                { label: 'Paid by', value: lodging.paidBy?.length ? lodging.paidBy.map(payerName).join(', ') : 'Not set' },
                { label: 'Travelers', value: travelersLabel },
                { label: 'Total cost', value: totalCostLabel },
                { label: 'Cost per night', value: lodging.costPerNight ? `$${lodging.costPerNight}` : '$0' },
                { label: 'Features', value: lodging.features?.length ? lodging.features.join(', ') : 'None listed' },
                { label: 'Notes', value: lodging.notes || 'None' },
              ] as DetailRow[]
            ).map((row) => (
              <View key={row.label} style={detailStyles.detailRow}>
                <Text style={detailStyles.detailLabel}>{row.label}</Text>
                {row.action ? (
                  <Text style={[detailStyles.detailValue, styles.linkText]} onPress={row.action}>
                    {row.value}
                  </Text>
                ) : (
                  <Text style={detailStyles.detailValue}>{row.value}</Text>
                )}
              </View>
            ))}
            {placeDetailsStatus === 'loading' ? (
              <View style={detailStyles.detailRow}>
                <Text style={detailStyles.detailLabel}>Place details</Text>
                <Text style={detailStyles.detailValue}>Loading...</Text>
              </View>
            ) : null}
            {placeDetailsRows.map((row) => (
              <View key={row.label} style={detailStyles.detailRow}>
                <Text style={detailStyles.detailLabel}>{row.label}</Text>
                {row.action ? (
                  <Text style={[detailStyles.detailValue, styles.linkText]} onPress={row.action}>
                    {row.value}
                  </Text>
                ) : (
                  <Text style={detailStyles.detailValue}>{row.value}</Text>
                )}
              </View>
            ))}
          </View>
          {Platform.OS === 'web' && lodging ? <TripDayMap tripId={lodging.tripId} points={[{ ...lodging, kind: 'lodging', title: lodging.name, address: lodging.address }]} backendUrl={backendUrl} requestHeaders={requestHeaders} /> : mapImageUrl ? (
            <View style={detailStyles.mapCard}>
              <Image style={[detailStyles.mapImage, themeStyle('components_LodgingDetailsDialog_6', { mapHeight: mapHeight }, (theme ?? _styleTheme))]} source={mapImageSource} resizeMode="cover" />
              <View style={detailStyles.mapMeta}>
                <Text style={detailStyles.summaryLabel}>Location preview</Text>
                <Text style={detailStyles.summaryValue} numberOfLines={2} onPress={() => onOpenMap(lodging.address)}>
                  {lodging.address}
                </Text>
                <TouchableOpacity onPress={() => onOpenMap(lodging.address)}>
                  <Text style={[styles.linkText, detailStyles.mapLink]}>Open in Maps</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
          <AddToCalendarButton event={lodgingCalendarEvent({ ...lodging, check_in_date: lodging.checkInDate, check_out_date: lodging.checkOutDate })} styles={styles} />
        </ScrollView>
        <View style={[styles.row, styles.detailActionsRow]}>
          <View style={detailStyles.actionGroup}>
            <TouchableOpacity
              style={styles.button}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={styles.buttonText}>Close</Text>
            </TouchableOpacity>
          </View>
          {!readOnly ? (
            <View style={detailStyles.actionGroup}>
              <TouchableOpacity
                style={styles.button}
                onPress={() => onEdit(lodging)}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${lodging.name || 'lodging'}`}
              >
                <Text style={styles.buttonText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.dangerButton]}
                onPress={() => onDelete(lodging)}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${lodging.name || 'lodging'}`}
              >
                <Text style={styles.dangerButtonText}>Delete</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
    </DialogShell>
  );
};

const LodgingDetailsDialog = memo(LodgingDetailsDialogComponent);

export default LodgingDetailsDialog;

const buildDetailStyles = (theme?: AppTheme) => StyleSheet.create(themeStyle('components_LodgingDetailsDialog_7', { theme: theme }, (theme ?? getStyleTheme('light', 'light'))));
