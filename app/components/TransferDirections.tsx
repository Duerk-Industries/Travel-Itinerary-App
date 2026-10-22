import React, { useState } from 'react';
import { Linking, Platform, Text, TouchableOpacity, View } from 'react-native';
import { buildTransferDirections, loadStoredMapPreference, mapAppOptions, type MapApp } from '../utils/mapLinks';

export default function TransferDirections({ origin, destination, transferType, mapApp, styles, compact = false }: {
  origin: string; destination: string; transferType: string; mapApp?: MapApp; styles: Record<string, any>; compact?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const preference = mapApp ?? loadStoredMapPreference();
  const route = buildTransferDirections(origin, destination, transferType, preference);
  const open = (url: string) => {
    setError(null);
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
    else void Linking.openURL(url).catch(() => setError('Could not open directions. Please try again.'));
  };
  const appName = mapAppOptions.find(option => option.key === route?.app)?.label ?? 'Maps';
  const label = route?.usesCurrentLocation ? 'Waze · from current location' : `${route?.mode === 'transit' ? 'Public transport' : 'Directions'} · ${appName}`;
  return <View style={{ gap: 4, marginVertical: compact ? 0 : 12 }}>
    <TouchableOpacity testID="transfer-directions" accessibilityRole="link" disabled={!route} accessibilityState={{ disabled: !route }}
      onPress={event => { event?.stopPropagation?.(); if (route) open(route.url); }} style={[styles.button, styles.outlineButton, { minHeight: 44, opacity: route ? 1 : 0.45 }]}>
      <Text style={styles.buttonText}>{route ? label : 'Directions'}</Text>
    </TouchableOpacity>
    {route?.usesCurrentLocation && <TouchableOpacity testID="transfer-saved-route" accessibilityRole="link"
      onPress={event => { event?.stopPropagation?.(); const fullRoute = buildTransferDirections(origin, destination, transferType, 'google'); if (fullRoute) open(fullRoute.url); }}
      style={[styles.button, styles.outlineButton, { minHeight: 44 }]}><Text style={styles.buttonText}>Saved route · Google Maps</Text></TouchableOpacity>}
    {!compact && !route && <Text style={styles.helperText}>Enter both locations to get directions.</Text>}
    {!compact && preference === 'waze' && route && <Text style={styles.helperText}>{route.mode === 'transit'
      ? 'Public transport opens in Google Maps because Waze supports driving only.'
      : 'Waze starts at your current location. Use Saved route for the transfer’s starting location.'}</Text>}
    {error && <Text accessibilityRole="alert" style={styles.helperText}>{error}</Text>}
  </View>;
}
