import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, ScrollView, Text, View, TouchableOpacity, useWindowDimensions, Image } from 'react-native';
import { type Lodging, fetchPlaceDetailsApi, type PlaceDetailsPayload } from '../tabs/lodging';
import { formatDateLong } from '../utils/formatDateLong';
import { buildStaticMapUrl } from '../utils/googleMaps';
import { LEGACY_ITINERARY_STATUS, normalizeItineraryStatus } from '../utils/itineraryStatus';

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
  payerName: (id: string) => string;
  travelerName?: (id: string) => string;
  onClose: () => void;
  onEdit: (lodging: Lodging) => void;
  onDelete: (lodging: Lodging) => void;
  onOpenMap: (address: string) => void;
  testID?: string;
};

const LodgingDetailsDialog: React.FC<LodgingDetailsDialogProps> = ({
  visible,
  lodging,
  attendees = [],
  backendUrl,
  requestHeaders,
  styles,
  payerName,
  travelerName,
  onClose,
  onEdit,
  onDelete,
  onOpenMap,
  testID,
}) => {
  const { width } = useWindowDimensions();
  const isCompact = width < 520;

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

  if (!visible || !lodging) return null;

  const mapImageUrl = lodging.address ? buildStaticMapUrl(lodging.address) : '';
  const photoUrl = placeDetails?.details?.photos?.[0]?.photoUri;
  const imageUrl = lodging.imageUrl || photoUrl;
  const dateRange = `${lodging.checkInDate ? formatDateLong(lodging.checkInDate) : 'TBD'}${lodging.checkOutDate ? ` – ${formatDateLong(lodging.checkOutDate)}` : ''}`;
  const travelerIds =
    Array.isArray(lodging.travelerIds) && lodging.travelerIds.length
      ? lodging.travelerIds
      : Array.isArray(lodging.paidBy)
        ? lodging.paidBy
        : [];

  useEffect(() => {
    if (!visible || !lodging) return;
    travelerIds.forEach((id) => {
      const attendee = attendees.find((a) => a.id === id);
      const firstName = attendee?.firstName ?? '';
      const lastName = attendee?.lastName ?? '';
      const displayName = `${firstName} ${lastName}`.trim();
      const email = attendee?.email ?? attendee?.userEmail ?? '';
      const pending = attendee?.status === 'pending';
      console.debug(
        `[overview][debug] traveler read (lodging details) id=${id} name="${displayName}" email=${email || 'n/a'} pending=${pending}`
      );
    });
  }, [attendees, lodging, travelerIds, visible]);
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
    <View style={styles.modalOverlay} testID={testID}>
      <View style={[styles.modalCard, detailStyles.detailCard, isCompact && { width: '100%', maxHeight: '95%' }]}>
        <ScrollView>
          <View style={detailStyles.imageWrap}>
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={detailStyles.image} resizeMode="cover" />
            ) : (
              <View style={detailStyles.imageFallback}>
                <Text style={styles.helperText}>No photo available</Text>
              </View>
            )}
            <TouchableOpacity style={detailStyles.closeButton} onPress={onClose}>
              <Text style={detailStyles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={detailStyles.headerRow}>
            <View style={detailStyles.headerMeta}>
              <Text style={detailStyles.title}>{lodging.name}</Text>
              <Text style={[styles.helperText, { marginTop: 2 }]} numberOfLines={2}>
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
          {mapImageUrl ? (
            <View style={detailStyles.mapCard}>
              <Image style={detailStyles.mapImage} source={{ uri: mapImageUrl }} resizeMode="cover" />
              <View style={detailStyles.mapMeta}>
                <Text style={detailStyles.summaryLabel}>Location preview</Text>
                <Text style={detailStyles.summaryValue} numberOfLines={2}>
                  {lodging.address}
                </Text>
                <TouchableOpacity onPress={() => onOpenMap(lodging.address)}>
                  <Text style={[styles.linkText, detailStyles.mapLink]}>Open in Maps</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </ScrollView>
        <View style={[styles.row, styles.detailActionsRow]}>
          <View style={detailStyles.actionGroup}>
            <TouchableOpacity style={styles.button} onPress={onClose}>
              <Text style={styles.buttonText}>Close</Text>
            </TouchableOpacity>
          </View>
          <View style={detailStyles.actionGroup}>
            <TouchableOpacity style={styles.button} onPress={() => onEdit(lodging)}>
              <Text style={styles.buttonText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={() => onDelete(lodging)}>
              <Text style={styles.buttonText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
};

export default LodgingDetailsDialog;

const detailStyles = StyleSheet.create({
  detailCard: {
    borderRadius: 16,
    overflow: 'hidden',
    padding: 0,
    maxWidth: 420,
    width: '100%',
  },
  imageWrap: {
    position: 'relative',
    height: 200,
    backgroundColor: '#e5e7eb',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageFallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(15,23,42,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 8,
  },
  headerMeta: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
  },
  statusBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#34d399',
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: '#ecfdf5',
  },
  statusText: {
    color: '#047857',
    fontWeight: '600',
  },
  summaryCard: {
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 12,
    backgroundColor: '#fff',
  },
  detailList: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  detailLabel: {
    width: 110,
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 13,
  },
  detailValue: {
    flex: 1,
    textAlign: 'left',
    color: '#111827',
    fontSize: 13,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryValue: {
    fontSize: 16,
    color: '#0f172a',
    fontWeight: '600',
    textAlign: 'right',
    maxWidth: '70%',
  },
  mapCard: {
    margin: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  mapImage: {
    width: '100%',
    height: 180,
    backgroundColor: '#e5e7eb',
  },
  mapMeta: {
    padding: 12,
    gap: 4,
  },
  mapLink: {
    fontWeight: '600',
  },
  actionGroup: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
});
