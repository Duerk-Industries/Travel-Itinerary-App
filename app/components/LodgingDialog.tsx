import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View, useWindowDimensions, TouchableOpacity } from 'react-native';
import type { LodgingDraft } from '../tabs/lodging';
import LodgingForm from './LodgingForm'; // Assuming we extract the form fields into this component
import DialogShell from './DialogShell';

type MemberOption = {
  id: string;
  guestName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  status?: 'active' | 'pending' | 'removed';
  removedAt?: string | null;
};

type LodgingDialogProps = {
  visible: boolean;
  title: string;
  draft: LodgingDraft;
  setDraft: React.Dispatch<React.SetStateAction<LodgingDraft>>;
  groupMembers: MemberOption[];
  formatMemberName: (member: MemberOption) => string;
  payerName: (id: string) => string;
  defaultPayerId?: string | null;
  styles: Record<string, any>;
  onSave: () => void;
  onSaveAndAddAnother?: () => void;
  onCancel: () => void;
  onOpenDatePicker?: (field: 'checkIn' | 'checkOut' | 'refundBy') => void;
  testID?: string;
};

const LodgingDialog: React.FC<LodgingDialogProps> = (props) => {
  const { width } = useWindowDimensions();
  const isCompact = width < 520;

  if (!props.visible) return null;

  return (
    <DialogShell
      visible={props.visible}
      title={props.title}
      styles={props.styles}
      onClose={props.onCancel}
      testID={props.testID}
      useNativeModal
      overlayStyle={{ justifyContent: 'center' }}
      cardStyle={[props.styles.modalCard, { marginTop: 0 }, isCompact && { width: '100%', maxHeight: '90%' }]}
    >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flexShrink: 1 }}
          >
            <ScrollView
              style={{ maxHeight: isCompact ? 520 : 440 }}
              contentContainerStyle={{ paddingRight: 12, paddingBottom: 16 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              nestedScrollEnabled
              contentInsetAdjustmentBehavior="automatic"
            >
              <LodgingForm {...props} isCompact={isCompact} />
            </ScrollView>
          </KeyboardAvoidingView>
          <View style={props.styles.row}>
            <TouchableOpacity
              style={[props.styles.button, props.styles.dangerButton]}
              onPress={props.onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={props.styles.dangerButtonText}>Cancel</Text>
            </TouchableOpacity>
            {props.onSaveAndAddAnother ? (
              <TouchableOpacity
                style={props.styles.button}
                onPress={props.onSaveAndAddAnother}
                accessibilityRole="button"
                accessibilityLabel="Save and add another"
              >
                <Text style={props.styles.buttonText}>Save &amp; Add Another</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={props.styles.button}
              onPress={props.onSave}
              accessibilityRole="button"
              accessibilityLabel="Save"
            >
              <Text style={props.styles.buttonText}>Save</Text>
            </TouchableOpacity>
          </View>
    </DialogShell>
  );
};

export default LodgingDialog;
