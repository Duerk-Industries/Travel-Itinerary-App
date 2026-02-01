import React from 'react';
import { ScrollView, Text, View, TouchableOpacity, useWindowDimensions, Image } from 'react-native';
import type { Lodging } from '../tabs/lodging';
import { formatDateLong } from '../utils/formatDateLong';
import { buildStaticMapUrl } from '../utils/googleMaps';

type LodgingDetailsDialogProps = {
  visible: boolean;
  lodging: Lodging | null;
  styles: Record<string, any>;
  payerName: (id: string) => string;
  onClose: () => void;
  onEdit: (lodging: Lodging) => void;
  onDelete: (lodging: Lodging) => void;
  onOpenMap: (address: string) => void;
  testID?: string;
};

const LodgingDetailsDialog: React.FC<LodgingDetailsDialogProps> = ({
  visible,
  lodging,
  styles,
  payerName,
  onClose,
  onEdit,
  onDelete,
  onOpenMap,
  testID,
}) => {
  const { width } = useWindowDimensions();
  const isCompact = width < 520;
  if (!visible || !lodging) return null;

  const mapImageUrl = lodging.address ? buildStaticMapUrl(lodging.address) : '';

  return (
    <View style={styles.modalOverlay} testID={testID}>
      <View style={[styles.modalCard, isCompact && { width: '100%', maxHeight: '95%' }]}>
        <View style={styles.detailHeaderRow}>
          <Text style={styles.sectionTitle}>{lodging.name}</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.linkText}>Close</Text>
          </TouchableOpacity>
        </View>
        {lodging.imageUrl ? (
          <Image source={{ uri: lodging.imageUrl }} style={styles.detailImage} resizeMode="cover" />
        ) : (
          <View style={styles.detailImageFallback}>
            <Text style={styles.helperText}>No photo available</Text>
          </View>
        )}
        <ScrollView
          style={{ maxHeight: isCompact ? 520 : 440 }}
          contentContainerStyle={{ paddingBottom: 12 }}
        >
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Address:</Text>
            <Text style={styles.detailValue}>{lodging.address || 'N/A'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Check-in:</Text>
            <Text style={styles.detailValue}>{formatDateLong(lodging.checkInDate)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Check-out:</Text>
            <Text style={styles.detailValue}>{formatDateLong(lodging.checkOutDate)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Rooms:</Text>
            <Text style={styles.detailValue}>{lodging.rooms || '1'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Total Cost:</Text>
            <Text style={styles.detailValue}>{lodging.totalCost ? `$${lodging.totalCost}` : 'N/A'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Cost Per Night:</Text>
            <Text style={styles.detailValue}>{lodging.costPerNight ? `$${lodging.costPerNight}` : 'N/A'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Refund By:</Text>
            <Text style={styles.detailValue}>{lodging.refundBy ? formatDateLong(lodging.refundBy) : 'N/A'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Travelers:</Text>
            <Text style={styles.detailValue}>
              {lodging.travelerIds.map(payerName).join(', ') || 'N/A'}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Paid By:</Text>
            <Text style={styles.detailValue}>
              {lodging.paidBy.map(payerName).join(', ') || 'N/A'}
            </Text>
          </View>
          {mapImageUrl ? (
            <View style={styles.mapPreview}>
              <Text style={styles.modalLabel}>Location preview</Text>
              <Image style={styles.detailMap} source={{ uri: mapImageUrl }} resizeMode="cover" />
            </View>
          ) : null}
        </ScrollView>
        <View style={[styles.row, styles.detailActionsRow]}>
          {lodging.address ? (
            <TouchableOpacity style={styles.button} onPress={() => onOpenMap(lodging.address)}>
              <Text style={styles.buttonText}>Map</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.button} onPress={() => onEdit(lodging)}>
            <Text style={styles.buttonText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={() => onDelete(lodging)}>
            <Text style={styles.buttonText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default LodgingDetailsDialog;
