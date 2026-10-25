import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { readWifiOnlyPreference, writeWifiOnlyPreference } from '../utils/offlineDownloadPolicy';

/**
 * Account-settings control for how saved trips refresh. The choice belongs to this device, not the account, so it is
 * stored locally rather than with the profile. It shares the option-button look of the other settings.
 */
export default function OfflineDownloadSettings({ styles }: { styles: any }) {
  const _styleTheme = useStyleTheme();
  const [wifiOnly, setWifiOnly] = useState(false);
  useEffect(() => {
    let live = true;
    void readWifiOnlyPreference().then((value) => { if (live) setWifiOnly(value); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const choose = (next: boolean) => { setWifiOnly(next); void writeWifiOnlyPreference(next).catch(() => undefined); };
  const options = [{ value: false, label: 'Any connection' }, { value: true, label: 'Wi-Fi only' }];
  return <View>
    <Text style={styles.modalLabel}>Update saved trips</Text>
    <View style={[styles.row, themeStyle('components_OfflineDownloadSettings_1', {  }, _styleTheme)]}>
      {options.map((option) => {
        const selected = wifiOnly === option.value;
        return <TouchableOpacity key={option.label} testID={`offline-wifi-${option.value ? 'only' : 'any'}`} accessibilityRole="button" accessibilityState={{ selected }}
          style={[styles.mapOptionButton, selected && styles.mapOptionActive, themeStyle('components_OfflineDownloadSettings_2', {  }, _styleTheme)]} onPress={() => choose(option.value)}>
          <Text style={[styles.mapOptionText, selected && styles.mapOptionActiveText]}>{option.label}</Text>
        </TouchableOpacity>;
      })}
    </View>
    <Text style={styles.helperText}>
      Automatic updates of trips saved on this device {wifiOnly ? 'wait for Wi-Fi' : 'also use mobile data'}. Saving a trip yourself always works, and asks first when you are on mobile data with this set to Wi-Fi only.
    </Text>
  </View>;
}
