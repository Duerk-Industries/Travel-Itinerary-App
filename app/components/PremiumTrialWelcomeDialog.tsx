import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import DialogShell from './DialogShell';

type PremiumTrialWelcomeDialogProps = {
  visible: boolean;
  styles: Record<string, any>;
  onViewPlans: () => void;
  onDismiss: () => void;
};

const PREMIUM_FEATURES = [
  'AI itinerary generation',
  'Email import for bookings',
  'Cost tracking and CSV exports',
  'Trip sharing and collaboration tools',
];

const PremiumTrialWelcomeDialog: React.FC<PremiumTrialWelcomeDialogProps> = ({
  visible,
  styles,
  onViewPlans,
  onDismiss,
}) => (
  <DialogShell
    visible={visible}
    title="Try Premium free"
    message="Start a 14-day Premium trial when you upgrade on the web. Premium unlocks:"
    styles={styles}
    onClose={onDismiss}
    testID="premium-trial-welcome-dialog"
    accessibilityRole="alert"
  >
    <View style={styles.premiumTrialFeatureList}>
      {PREMIUM_FEATURES.map((feature) => (
        <Text key={feature} style={styles.helperText}>
          {`• ${feature}`}
        </Text>
      ))}
    </View>
    <View style={styles.row}>
      <TouchableOpacity
        style={[styles.button, styles.smallButton]}
        onPress={onViewPlans}
        testID="premium-trial-view-plans"
        accessibilityRole="button"
        accessibilityLabel="View Premium plans"
      >
        <Text style={styles.buttonText}>View Premium plans</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.button, styles.smallButton, styles.secondaryButton]}
        onPress={onDismiss}
        testID="premium-trial-dismiss"
        accessibilityRole="button"
        accessibilityLabel="Continue without viewing Premium plans"
      >
        <Text style={styles.secondaryButtonText}>Continue</Text>
      </TouchableOpacity>
    </View>
  </DialogShell>
);

export default PremiumTrialWelcomeDialog;
