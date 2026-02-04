import React from 'react';
import { ScrollView, Text, View, useWindowDimensions, TouchableOpacity } from 'react-native';
import type { LodgingDraft } from '../tabs/lodging';
import LodgingForm from './LodgingForm'; // Assuming we extract the form fields into this component

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
  onCancel: () => void;
  onOpenDatePicker?: (field: 'checkIn' | 'checkOut' | 'refundBy') => void;
  testID?: string;
};

const LodgingDialog: React.FC<LodgingDialogProps> = (props) => {
  const { width } = useWindowDimensions();
  const isCompact = width < 520;

  if (!props.visible) return null;

  return (
    <View style={[props.styles.modalOverlay, { justifyContent: 'flex-start' }]} testID={props.testID}>
      <View style={[props.styles.modalCard, isCompact && { width: '100%', maxHeight: '90%' }]}>
        <Text style={props.styles.sectionTitle}>{props.title}</Text>
        <ScrollView style={{ maxHeight: isCompact ? 520 : 440 }}>
          <LodgingForm {...props} isCompact={isCompact} />
        </ScrollView>
        <View style={props.styles.row}>
          <TouchableOpacity style={[props.styles.button, props.styles.dangerButton]} onPress={props.onCancel}>
            <Text style={props.styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={props.styles.button} onPress={props.onSave}>
            <Text style={props.styles.buttonText}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default LodgingDialog;
