import React, { useState, useCallback } from 'react';
import { TouchableOpacity, Text, ActivityIndicator, Alert, Platform } from 'react-native';
import { AppTheme } from '../theme/theme';

type PlaidSuccess = {
  publicToken: string;
  metadata?: { institution?: { id?: string; name?: string } | null };
};

type PlaidExit = {
  error?: { displayMessage?: string | null } | null;
};

type PlaidSdk = {
  openLink: (config: {
    token: string;
    onSuccess: (success: PlaidSuccess) => void | Promise<void>;
    onExit: (exit: PlaidExit) => void;
  }) => Promise<void>;
};

let plaidSdk: PlaidSdk | null | undefined;
const getPlaidSdk = (): PlaidSdk | null => {
  if (plaidSdk !== undefined) return plaidSdk;
  try {
    plaidSdk = require('react-native-plaid-link-sdk') as PlaidSdk;
  } catch {
    plaidSdk = null;
  }
  return plaidSdk;
};

type PlaidLinkButtonProps = {
  theme: AppTheme;
  backendUrl: string;
  jsonHeaders: Record<string, string>;
  onSuccess: (itemId: string) => void;
  style?: any;
};

const PlaidLinkButton: React.FC<PlaidLinkButtonProps> = ({
  theme,
  backendUrl,
  jsonHeaders,
  onSuccess,
  style,
}) => {
  const { colors, typography, spacing } = theme;
  const [loading, setLoading] = useState(false);

  const handlePress = useCallback(async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Not Supported', 'Bank connection is currently only supported on iOS and Android.');
      return;
    }

    setLoading(true);
    try {
      // 1. Create link token via Firebase Function (callable)
      // For now, I'll use a standard POST to the server which delegates if needed,
      // but the plan says "Firebase Functions for all Plaid API calls".
      // Host app should ideally call the Function directly.
      // Assuming the host app server (Cloud Run) can also expose it or we call Functions SDK.

      const res = await fetch(`${backendUrl}/api/plaid/link-token`, {
        method: 'POST',
        headers: jsonHeaders,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to initialize Plaid Link');

      const linkToken = data.linkToken;
      const sdk = getPlaidSdk();
      if (!sdk) throw new Error('Bank connection is unavailable in this app build.');

      // 2. Open Plaid Link
      await sdk.openLink({
        token: linkToken,
        onSuccess: async (success: PlaidSuccess) => {
          setLoading(true);
          try {
            const exchangeRes = await fetch(`${backendUrl}/api/plaid/exchange-token`, {
              method: 'POST',
              headers: jsonHeaders,
              body: JSON.stringify({
                publicToken: success.publicToken,
                institutionId: success.metadata?.institution?.id,
                institutionName: success.metadata?.institution?.name,
              }),
            });
            const exchangeData = await exchangeRes.json();
            if (!exchangeRes.ok) throw new Error(exchangeData.error || 'Failed to connect account');
            onSuccess(exchangeData.itemId);
          } catch (err: any) {
            Alert.alert('Connection Failed', err.message);
          } finally {
            setLoading(false);
          }
        },
        onExit: (exit: PlaidExit) => {
          if (exit.error) {
            Alert.alert('Plaid Error', exit.error.displayMessage || 'An error occurred during connection.');
          }
          setLoading(false);
        },
      });
    } catch (error: any) {
      Alert.alert('Error', error.message);
      setLoading(false);
    }
  }, [backendUrl, jsonHeaders, onSuccess]);

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={loading}
      style={[
        {
          backgroundColor: colors.cta,
          paddingVertical: spacing.md,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#0B1726" />
      ) : (
        <Text style={{ color: '#0B1726', fontWeight: 'bold', fontSize: typography.body }}>
          Connect Bank Account
        </Text>
      )}
    </TouchableOpacity>
  );
};

export default PlaidLinkButton;
