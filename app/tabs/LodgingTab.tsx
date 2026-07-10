
// @ts-nocheck
import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import HorizontalTableScroll from '../components/HorizontalTableScroll';
import { type Lodging, type LodgingDraft, buildLodgingPayload, createLodgingDraftForTrip, saveLodgingApi, removeLodgingApi } from './lodging';
import { formatUserDisplayName } from './overview';
import LodgingDialog from '../components/LodgingDialog';
import LodgingDetailsDialog from '../components/LodgingDetailsDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import { LEGACY_ITINERARY_STATUS, normalizeItineraryStatus } from '../utils/itineraryStatus';
import { formatNetVotes, shouldShowRatingButtons, shouldShowVoteButtons } from '../utils/votes';
import type { AppTheme } from '../theme/theme';

type LodgingTabProps = {
  backendUrl: string;
  jsonHeaders: Record<string, string>,
  requestHeaders: Record<string, string>,
  trip: { id: string, startDate?: string | null } | null;
  lodgings: Lodging[];
  groupMembers: any[];
  defaultPayerId: string | null;
  styles: Record<string, any>;
  onRefreshLodgings?: () => void;
  onOpenMap: (address: string) => void;
  formatMemberName: (member: any) => string; // This will be ignored, but kept for compatibility
  payerName: (id: string) => string;
  theme?: AppTheme;
  readOnly?: boolean;
};

export const formatShortDate = (dateString?: string | null): string => {
  if (!dateString) return '-';
  const hasDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateString);
  const target = hasDateOnly ? `${dateString}T00:00:00` : dateString;
  const parsed = new Date(target);
  if (Number.isNaN(parsed.getTime())) return dateString;
  const weekday = parsed.toLocaleDateString('en-US', { weekday: 'short' });
  const month = parsed.toLocaleDateString('en-US', { month: 'short' });
  const weekdayLabel = weekday.endsWith('.') ? weekday : `${weekday}.`;
  const monthLabel = month.endsWith('.') ? month : `${month}.`;
  return `${weekdayLabel} ${monthLabel} ${parsed.getDate()}`;
};

const LodgingTab: React.FC<LodgingTabProps> = ({
  backendUrl,
  jsonHeaders,
  requestHeaders,
  trip,
  lodgings,
  groupMembers,
  defaultPayerId,
  styles,
  onRefreshLodgings,
  onOpenMap,
  formatMemberName: _formatMemberName, // unused
  payerName: _payerName, // unused
  theme,
  readOnly = false,
}) => {
  const [selectedLodging, setSelectedLodging] = useState<Lodging | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editingLodging, setEditingLodging] = useState<Lodging | null>(null);
  const [lodgingDraft, setLodgingDraft] = useState<LodgingDraft | null>(null);
  const [lodgingToDelete, setLodgingToDelete] = useState<Lodging | null>(null);

  const activeTripId = trip?.id;

  const openAddDialog = () => {
    if (readOnly) return;
    if (!activeTripId) {
      Alert.alert('Please select a trip first.');
      return;
    }
    const draft = createLodgingDraftForTrip({
      tripStartDate: trip?.startDate,
      existingLodgings: lodgings,
      defaultPayerId: defaultPayerId,
      defaultTravelerIds: groupMembers.map((m) => m.id).filter(Boolean),
    });
    setLodgingDraft(draft);
    setEditingLodging(null);
    setShowEditor(true);
  };

  const openEditDialog = (lodging: Lodging) => {
    if (readOnly) return;
    const draft = {
      ...lodging,
      totalCost: lodging.totalCost?.toString() || '',
      costPerNight: lodging.costPerNight?.toString() || '',
      rooms: lodging.rooms?.toString() || '1',
    };
    setLodgingDraft(draft);
    setEditingLodging(lodging);
    setShowDetails(false);
    setShowEditor(true);
  };

  const openDetailsDialog = (lodging: Lodging) => {
    setSelectedLodging(lodging);
    setShowDetails(true);
  };

  const closeEditor = () => {
    setShowEditor(false);
    setEditingLodging(null);
    setLodgingDraft(null);
  };

  const closeDetails = () => {
    setShowDetails(false);
    setSelectedLodging(null);
  };

  const handleSave = async () => {
    if (readOnly) return;
    if (!lodgingDraft || !activeTripId) return;

    const { payload, error } = buildLodgingPayload(lodgingDraft, activeTripId, defaultPayerId);
    if (error || !payload) {
      Alert.alert(error || 'Failed to save lodging.');
      return;
    }

    const result = await saveLodgingApi(backendUrl, jsonHeaders, payload, editingLodging?.id);
    if (result.ok) {
      onRefreshLodgings?.();
      closeEditor();
    } else {
      Alert.alert(result.error || 'Failed to save lodging.');
    }
  };

  const handleDelete = async () => {
    if (readOnly) return;
    if (!lodgingToDelete) return;
    const result = await removeLodgingApi(backendUrl, jsonHeaders, lodgingToDelete.id);
    if (result.ok) {
      onRefreshLodgings?.();
      setLodgingToDelete(null);
      closeDetails();
    } else {
      Alert.alert(result.error || 'Failed to delete lodging.');
    }
  };

  const voteOnLodging = async (lodgingId: string, value: 1 | -1) => {
    if (readOnly) return;
    const res = await fetch(`${backendUrl}/api/lodgings/${lodgingId}/vote`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ value }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      Alert.alert(data.error || 'Unable to submit vote');
      return;
    }
    onRefreshLodgings?.();
  };

  const rateOnLodging = async (lodgingId: string, value: 1 | -1) => {
    if (readOnly) return;
    const res = await fetch(`${backendUrl}/api/lodgings/${lodgingId}/rating`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ value }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      Alert.alert(data.error || 'Unable to submit rating');
      return;
    }
    onRefreshLodgings?.();
  };
  
  const sortedLodgings = useMemo(() => {
    const safeDate = (value?: string | null) => {
      const text = String(value ?? '').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '9999-12-31';
    };
    return [...lodgings].sort((a, b) => {
      const byCheckIn = safeDate(a.checkInDate).localeCompare(safeDate(b.checkInDate));
      if (byCheckIn !== 0) return byCheckIn;
      const byCheckOut = safeDate(a.checkOutDate).localeCompare(safeDate(b.checkOutDate));
      if (byCheckOut !== 0) return byCheckOut;
      return String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' });
    });
  }, [lodgings]);

  const travelerNames = useMemo(() => {
    const map = new Map<string, string>();
    groupMembers.forEach(member => {
      map.set(member.id, formatUserDisplayName(member));
    });
    return map;
  }, [groupMembers]);

  const payerName = (id: string) => travelerNames.get(id) ?? 'Unknown';
  const travelerName = (id: string) => travelerNames.get(id) ?? 'Unknown';

  return (
    <View style={[styles.card, { flex: 1, minHeight: 0 }]}>
      <View style={styles.row}>
        <Text style={styles.sectionTitle}>Lodging</Text>
        {!readOnly ? (
          <TouchableOpacity style={[styles.button, styles.roundButton]} onPress={openAddDialog} testID="lodging-add">
            <Text style={styles.buttonText}>+</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ flexGrow: 1 }}>
        <HorizontalTableScroll
          style={styles.tableScroll}
          contentContainerStyle={styles.tableScrollContent}
          testID="lodging-table-horizontal-scroll"
          nestedScrollEnabled
          directionalLockEnabled
        >
        <View style={[styles.table, styles.lodgingTable, { minWidth: 878 }]}>
          <View style={[styles.tableRow, styles.tableHeaderRow]}>
            <View style={[styles.tableHeaderCell, styles.lodgingTabNameCol]}>
              <Text style={styles.headerText}>Name</Text>
            </View>
            <View style={[styles.tableHeaderCell, styles.lodgingTabDateCol]}>
              <Text style={styles.headerText}>Check-In</Text>
            </View>
            <View style={[styles.tableHeaderCell, styles.lodgingTabDateCol]}>
              <Text style={styles.headerText}>Check-Out</Text>
            </View>
            <View style={[styles.tableHeaderCell, styles.lodgingTabDateCol]}>
              <Text style={styles.headerText}>Status</Text>
            </View>
            <View style={[styles.tableHeaderCell, styles.lodgingTabDateCol]}>
              <Text style={styles.headerText}>Votes</Text>
            </View>
            <View style={[styles.tableHeaderCell, styles.lodgingTabDateCol]}>
              <Text style={styles.headerText}>Rating</Text>
            </View>
            <View style={[styles.tableHeaderCell, styles.lodgingTabActionsCol, styles.lastCell]}>
              <Text style={styles.headerText}>Actions</Text>
            </View>
          </View>
          {sortedLodgings.map((lodging) => (
            <View key={lodging.id} style={[styles.tableRow, styles.lodgingTableRow]} testID={`lodging-row-${lodging.id}`}>
              <View style={[styles.tableCell, styles.lodgingTabNameCol]}>
                <TouchableOpacity
                  style={styles.tableNameButton}
                  onPress={() => openDetailsDialog(lodging)}
                >
                  <Text style={[styles.cellText, styles.cellTextWrap]}>{lodging.name}</Text>
                </TouchableOpacity>
              </View>
              <View style={[styles.tableCell, styles.lodgingTabDateCol]}>
                <Text style={styles.cellText}>{formatShortDate(lodging.checkInDate)}</Text>
              </View>
              <View style={[styles.tableCell, styles.lodgingTabDateCol]}>
                <Text style={styles.cellText}>{formatShortDate(lodging.checkOutDate)}</Text>
              </View>
              <View style={[styles.tableCell, styles.lodgingTabDateCol]}>
                <Text style={styles.cellText}>{normalizeItineraryStatus(lodging.status, LEGACY_ITINERARY_STATUS)}</Text>
              </View>
              <View style={[styles.tableCell, styles.lodgingTabDateCol]}>
                {!readOnly && shouldShowVoteButtons(lodging.status, (lodging as any).userVote) ? (
                  <View style={styles.actionCell}>
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => voteOnLodging(lodging.id, 1)}>
                      <Text style={styles.buttonText}>👍</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => voteOnLodging(lodging.id, -1)}>
                      <Text style={styles.buttonText}>👎</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.cellText}>{formatNetVotes((lodging as any).netVotes ?? 0)}</Text>
                )}
              </View>
              <View style={[styles.tableCell, styles.lodgingTabDateCol]}>
                {!readOnly && shouldShowRatingButtons(lodging.status, (lodging as any).userRating) ? (
                  <View style={styles.actionCell}>
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => rateOnLodging(lodging.id, 1)}>
                      <Text style={styles.buttonText}>👍</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => rateOnLodging(lodging.id, -1)}>
                      <Text style={styles.buttonText}>👎</Text>
                    </TouchableOpacity>
                  </View>
                ) : normalizeItineraryStatus(lodging.status, LEGACY_ITINERARY_STATUS) === 'Completed' ? (
                  <Text style={styles.cellText}>{formatNetVotes((lodging as any).netRating ?? 0)}</Text>
                ) : (
                  <Text style={styles.cellText}>-</Text>
                )}
              </View>
              <View style={[styles.tableCell, styles.lodgingTabActionsCol, styles.lastCell]}>
                <View style={[styles.actionCell, { flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'flex-start' }]}>
                  {!readOnly ? (
                    <>
                      <TouchableOpacity
                        style={[styles.tableActionButton, styles.tableActionButtonPrimary]}
                        onPress={() => openEditDialog(lodging)}
                        testID={`lodging-edit-${lodging.id}`}
                      >
                        <Text style={styles.buttonText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.tableActionButton, styles.tableActionButtonDanger]}
                        onPress={() => setLodgingToDelete(lodging)}
                        testID={`lodging-delete-${lodging.id}`}
                      >
                        <Text style={styles.buttonText}>Delete</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <Text style={styles.cellText}>View only</Text>
                  )}
                </View>
              </View>
            </View>
          ))}
        </View>
        </HorizontalTableScroll>
      </ScrollView>

      {showDetails && selectedLodging && (
        <LodgingDetailsDialog
          testID="lodging-details-dialog"
          visible={showDetails}
          lodging={selectedLodging}
          backendUrl={backendUrl}
          requestHeaders={requestHeaders}
          styles={styles}
          theme={theme}
          payerName={payerName}
          travelerName={travelerName}
          readOnly={readOnly}
          onClose={closeDetails}
          onEdit={openEditDialog}
          onDelete={() => setLodgingToDelete(selectedLodging)}
          onOpenMap={onOpenMap}
        />
      )}

      {showEditor && lodgingDraft && (
        <LodgingDialog
          testID="lodging-editor-dialog"
          visible={showEditor}
          title={editingLodging ? 'Lodging Details' : 'Add Lodging'}
          draft={lodgingDraft}
          setDraft={setLodgingDraft}
          groupMembers={groupMembers}
          formatMemberName={formatUserDisplayName}
          payerName={payerName}
          defaultPayerId={defaultPayerId}
          styles={styles}
          onSave={handleSave}
          onCancel={closeEditor}
        />
      )}

      {lodgingToDelete && (
          <ConfirmDialog
            testID="delete-lodging-dialog"
            visible
            title="Delete Lodging"
            message={`Are you sure you want to delete ${lodgingToDelete.name}?`}
            onCancel={() => setLodgingToDelete(null)}
            onConfirm={handleDelete}
            styles={styles}
        />
      )}
    </View>
  );
};

export default LodgingTab;
