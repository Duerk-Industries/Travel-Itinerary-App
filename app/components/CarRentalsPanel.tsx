import React from 'react';
import { Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { CarRental, CarRentalDraft } from '../tabs/carRentals';
import type { GroupMemberOption } from '../tabs/transfers';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import { toWebStyle } from '../utils/webStyle';
import {
  DEFAULT_NEW_ITINERARY_STATUS,
  ITINERARY_STATUSES,
  LEGACY_ITINERARY_STATUS,
  normalizeItineraryStatus,
} from '../utils/itineraryStatus';
import { formatNetVotes, shouldShowRatingButtons, shouldShowVoteButtons } from '../utils/votes';
import DropdownOptionButton from './DropdownOptionButton';

export type CarRentalsPanelProps = {
  /** Committed car-rental rows rendered in the table. */
  carRentals: CarRental[];
  /** Form draft for the "Add Car Rental" section. */
  carDraft: CarRentalDraft;
  setCarDraft: React.Dispatch<React.SetStateAction<CarRentalDraft>>;
  /** Prepaid dropdown visibility — lifted so the caller can coordinate with outside-click handling if needed. */
  carPrepaidOpen: boolean;
  setCarPrepaidOpen: React.Dispatch<React.SetStateAction<boolean>>;
  /** Refs into the native <input type=date> fields on web. Used to fire `.showPicker()`. */
  carPickupDateRef: React.RefObject<HTMLInputElement | null>;
  carDropoffDateRef: React.RefObject<HTMLInputElement | null>;
  /** When true the form + action buttons are hidden (read-only follower view). */
  isFollowingMode: boolean;
  /** User-type (non-guest, non-removed) group members — feeds the For/Paid By chip lists. */
  userMembers: GroupMemberOption[];
  /** Full `styles` object from the parent App.tsx — the panel consumes ~30 named styles. */
  styles: Record<string, any>;
  /** Resolve a member-id to a printable name (falls back to "Unknown" at call site). */
  payerName: (id: string) => string;
  /** Formats a member's display name for the chip buttons. */
  formatMemberName: (member: GroupMemberOption) => string;
  /** Submit the current draft. Wired to the parent's `addCarRental`. */
  onAddCarRental: () => void | Promise<void>;
  /** Delete a car-rental row by id. */
  onRemoveCarRental: (id: string) => void | Promise<void>;
  /** Upvote/downvote a proposed rental (±1). */
  onVoteCarRental: (id: string, value: 1 | -1) => void | Promise<void>;
  /** Post-trip rating (±1). */
  onRateCarRental: (id: string, value: 1 | -1) => void | Promise<void>;
  /** Open the date picker for either pickup or drop-off. On web this fires `ref.showPicker()`; on native it toggles the NativeDateTimePicker that lives in the parent. */
  onOpenCarDatePicker: (field: 'pickup' | 'dropoff') => void;
};

/**
 * Car Rentals panel — table of current rentals + an add-rental form. Lives
 * inside `renderSharedPageScroll` in App.tsx and was extracted verbatim as
 * part of the Priority 4 App.tsx decomposition. Presentational only: all
 * state lives in the parent and is pushed in via props. The native
 * DateTimePicker fallback (shown on iOS/Android when `Platform.OS !== 'web'`)
 * is intentionally NOT rendered here — it belongs to the parent component so
 * that the picker sits at the root of the trip screen and not nested inside
 * this panel's ScrollView.
 */
const CarRentalsPanel: React.FC<CarRentalsPanelProps> = ({
  carRentals,
  carDraft,
  setCarDraft,
  carPrepaidOpen,
  setCarPrepaidOpen,
  carPickupDateRef,
  carDropoffDateRef,
  isFollowingMode,
  userMembers,
  styles,
  payerName,
  formatMemberName,
  onAddCarRental,
  onRemoveCarRental,
  onVoteCarRental,
  onRateCarRental,
  onOpenCarDatePicker,
}) => {
  return (
    <View style={styles.card} testID="car-rentals-panel">
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Car Rentals</Text>
      </View>
      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeaderRow]}>
          <View style={[styles.tableHeaderCell, { flex: 2, minWidth: 240 }]}>
            <Text style={styles.headerText}>Route</Text>
          </View>
          <View style={[styles.tableHeaderCell, { minWidth: 120 }]}>
            <Text style={styles.headerText}>Pick-up</Text>
          </View>
          <View style={[styles.tableHeaderCell, { minWidth: 120 }]}>
            <Text style={styles.headerText}>Drop-off</Text>
          </View>
          <View style={[styles.tableHeaderCell, { minWidth: 110 }]}>
            <Text style={styles.headerText}>Status</Text>
          </View>
          <View style={[styles.tableHeaderCell, { minWidth: 110 }]}>
            <Text style={styles.headerText}>Votes</Text>
          </View>
          <View style={[styles.tableHeaderCell, { minWidth: 110 }]}>
            <Text style={styles.headerText}>Rating</Text>
          </View>
          <View style={[styles.tableHeaderCell, { minWidth: 180 }, styles.lastCell]}>
            <Text style={styles.headerText}>Actions</Text>
          </View>
        </View>

        {carRentals.map((car, idx, arr) => (
          <View key={car.id} style={[styles.tableRow, idx === arr.length - 1 && styles.lastRow]}>
            <View style={[styles.tableCell, { flex: 2, minWidth: 240 }]}>
              <Text style={styles.cellText}>
                {`${car.pickupLocation || 'Pickup'} → ${car.dropoffLocation || 'Drop-off'}`}
              </Text>
              {(car.vendor || car.model || car.reference) ? (
                <Text style={styles.helperText}>
                  {[car.vendor, car.model, car.reference].filter(Boolean).join(' • ')}
                </Text>
              ) : null}
            </View>
            <View style={[styles.tableCell, { minWidth: 120 }]}>
              <Text style={styles.cellText}>{car.pickupDate || '-'}</Text>
            </View>
            <View style={[styles.tableCell, { minWidth: 120 }]}>
              <Text style={styles.cellText}>{car.dropoffDate || '-'}</Text>
            </View>
            <View style={[styles.tableCell, { minWidth: 110 }]}>
              <Text style={styles.cellText}>
                {normalizeItineraryStatus((car as any).status, LEGACY_ITINERARY_STATUS)}
              </Text>
            </View>
            <View style={[styles.tableCell, { minWidth: 110 }]}>
              <Text style={styles.cellText}>{formatNetVotes((car as any).netVotes ?? 0)}</Text>
            </View>
            <View style={[styles.tableCell, { minWidth: 110 }]}>
              {normalizeItineraryStatus((car as any).status, LEGACY_ITINERARY_STATUS) === 'Completed' ? (
                <Text style={styles.cellText}>{formatNetVotes((car as any).netRating ?? 0)}</Text>
              ) : (
                <Text style={styles.cellText}>-</Text>
              )}
            </View>
            <View style={[styles.tableCell, { minWidth: 180 }, styles.lastCell]}>
              <View style={styles.actionCell}>
                {!isFollowingMode && shouldShowVoteButtons((car as any).status, (car as any).userVote) ? (
                  <>
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => onVoteCarRental(car.id, 1)}>
                      <Text style={styles.buttonText}>👍</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => onVoteCarRental(car.id, -1)}>
                      <Text style={styles.buttonText}>👎</Text>
                    </TouchableOpacity>
                  </>
                ) : null}
                {!isFollowingMode && shouldShowRatingButtons((car as any).status, (car as any).userRating) ? (
                  <>
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => onRateCarRental(car.id, 1)}>
                      <Text style={styles.buttonText}>⭐</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => onRateCarRental(car.id, -1)}>
                      <Text style={styles.buttonText}>✖</Text>
                    </TouchableOpacity>
                  </>
                ) : null}
                {!isFollowingMode ? (
                  <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => onRemoveCarRental(car.id)} testID={`car-rental-delete-${car.id}`}>
                    <Text style={styles.dangerButtonText}>Delete</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.cellText}>View only</Text>
                )}
              </View>
            </View>
          </View>
        ))}
      </View>

      {!isFollowingMode ? (
        <View style={styles.carFormSection}>
          <Text style={styles.helperText}>Add Car Rental</Text>
          <View style={styles.carFormGrid}>
            <TextInput
              style={[styles.input, styles.carFormField]}
              placeholder="Pick up location"
              value={carDraft.pickupLocation}
              onChangeText={(text: string) => setCarDraft((p) => ({ ...p, pickupLocation: text }))}
            />
            <View style={[styles.dateInputWrap, styles.carFormField]}>
              {Platform.OS === 'web' ? (
                <input
                  ref={carPickupDateRef as any}
                  type="date"
                  value={carDraft.pickupDate}
                  onChange={(e) => setCarDraft((p) => ({ ...p, pickupDate: e.target.value }))}
                  style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box', marginBottom: 0 })}
                />
              ) : (
                <TouchableOpacity
                  style={[styles.input, styles.dateTouchable, { marginBottom: 0 }]}
                  onPress={() => onOpenCarDatePicker('pickup')}
                >
                  <Text style={styles.cellText}>{carDraft.pickupDate || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.dateIcon} onPress={() => onOpenCarDatePicker('pickup')}>
                <Text style={styles.selectCaret}>📅</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.input, styles.carFormField]}
              placeholder="Drop off location"
              value={carDraft.dropoffLocation}
              onChangeText={(text: string) => setCarDraft((p) => ({ ...p, dropoffLocation: text }))}
            />
            <View style={[styles.dateInputWrap, styles.carFormField]}>
              {Platform.OS === 'web' ? (
                <input
                  ref={carDropoffDateRef as any}
                  type="date"
                  value={carDraft.dropoffDate}
                  onChange={(e) => setCarDraft((p) => ({ ...p, dropoffDate: e.target.value }))}
                  style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box', marginBottom: 0 })}
                />
              ) : (
                <TouchableOpacity
                  style={[styles.input, styles.dateTouchable, { marginBottom: 0 }]}
                  onPress={() => onOpenCarDatePicker('dropoff')}
                >
                  <Text style={styles.cellText}>{carDraft.dropoffDate || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.dateIcon} onPress={() => onOpenCarDatePicker('dropoff')}>
                <Text style={styles.selectCaret}>📅</Text>
              </TouchableOpacity>
            </View>
            {Platform.OS === 'web' ? (
              <select
                value={normalizeItineraryStatus(carDraft.status, DEFAULT_NEW_ITINERARY_STATUS)}
                onChange={(e) => setCarDraft((p) => ({ ...p, status: normalizeItineraryStatus(e.target.value, DEFAULT_NEW_ITINERARY_STATUS) }))}
                style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box', marginBottom: 0 })}
              >
                {ITINERARY_STATUSES.map((opt) => (
                  <option key={`car-status-${opt}`} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <Text style={styles.cellText}>{normalizeItineraryStatus(carDraft.status, DEFAULT_NEW_ITINERARY_STATUS)}</Text>
            )}
            <TextInput
              style={[styles.input, styles.carFormField]}
              placeholder="Reference"
              value={carDraft.reference}
              onChangeText={(text: string) => setCarDraft((p) => ({ ...p, reference: text }))}
            />
            <TextInput
              style={[styles.input, styles.carFormField]}
              placeholder="Vendor"
              value={carDraft.vendor}
              onChangeText={(text: string) => setCarDraft((p) => ({ ...p, vendor: text }))}
            />
            <View style={[styles.dropdown, styles.carFormField]}>
              <TouchableOpacity
                style={[
                  styles.input,
                  styles.selectButtonRow,
                  styles.prepaidSelectorButton,
                  carDraft.prepaid ? styles.prepaidSelectorButtonSelected : null,
                ]}
                onPress={() => setCarPrepaidOpen((s) => !s)}
              >
                <Text style={[styles.cellText, styles.prepaidSelectorText]}>
                  {carDraft.prepaid ? `Prepaid: ${carDraft.prepaid}` : 'Prepaid? Select Yes or No'}
                </Text>
                <Text style={styles.selectCaret}>▾</Text>
              </TouchableOpacity>
              {carPrepaidOpen ? (
                <View style={[styles.dropdownList, styles.prepaidDropdownList]}>
                  {['Yes', 'No'].map((opt) => (
                    <DropdownOptionButton
                      key={opt}
                      styles={styles}
                      onPress={() => {
                        setCarDraft((p) => ({ ...p, prepaid: opt }));
                        setCarPrepaidOpen(false);
                      }}
                    >
                      <Text style={styles.cellText}>{opt}</Text>
                    </DropdownOptionButton>
                  ))}
                </View>
              ) : null}
            </View>
            <TextInput
              style={[styles.input, styles.carFormField]}
              placeholder="Cost"
              keyboardType="numeric"
              value={carDraft.cost}
              onChangeText={(text: string) => setCarDraft((p) => ({ ...p, cost: sanitizeCostInput(text) }))}
            />
            <TextInput
              style={[styles.input, styles.carFormField]}
              placeholder="Car model"
              value={carDraft.model}
              onChangeText={(text: string) => setCarDraft((p) => ({ ...p, model: text }))}
            />
            <TextInput
              style={[styles.input, styles.carFormWideField, styles.cellTextWrap]}
              placeholder="Notes"
              value={carDraft.notes}
              onChangeText={(text: string) => setCarDraft((p) => ({ ...p, notes: text }))}
              multiline
            />
          </View>
          <View style={styles.carMemberRow}>
            <View style={[styles.carMemberField, { flex: 1 }]}>
              <Text style={styles.modalLabelSmall}>For</Text>
              <View style={styles.payerChips}>
                {carDraft.travelerIds.map((id) => (
                  <View key={`car-traveler-${id}`} style={styles.payerChip}>
                    <Text style={styles.cellText}>{payerName(id)}</Text>
                    <TouchableOpacity onPress={() => setCarDraft((prev) => ({ ...prev, travelerIds: prev.travelerIds.filter((x) => x !== id) }))}>
                      <Text style={styles.removeText}>x</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
              <View style={styles.payerOptions}>
                {userMembers
                  .filter((m) => !carDraft.travelerIds.includes(m.id))
                  .map((m) => (
                    <TouchableOpacity
                      key={`car-traveler-add-${m.id}`}
                      style={styles.smallButton}
                      onPress={() =>
                        setCarDraft((prev) => ({
                          ...prev,
                          travelerIds: [...prev.travelerIds, m.id],
                        }))
                      }
                    >
                      <Text style={styles.buttonText}>Add {formatMemberName(m)}</Text>
                    </TouchableOpacity>
                  ))}
              </View>
            </View>
            <View style={[styles.carMemberField, { flex: 1 }]}>
              <Text style={styles.modalLabelSmall}>Paid By</Text>
              <View style={styles.payerChips}>
                {carDraft.paidBy.map((id) => (
                  <View key={id} style={styles.payerChip}>
                    <Text style={styles.cellText}>{payerName(id)}</Text>
                    <TouchableOpacity onPress={() => setCarDraft((prev) => ({ ...prev, paidBy: prev.paidBy.filter((x) => x !== id) }))}>
                      <Text style={styles.removeText}>x</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
              <View style={styles.payerOptions}>
                {userMembers
                  .filter((m) => !carDraft.paidBy.includes(m.id))
                  .map((m) => (
                    <TouchableOpacity
                      key={m.id}
                      style={styles.smallButton}
                      onPress={() => setCarDraft((prev) => ({ ...prev, paidBy: [...prev.paidBy, m.id] }))}
                    >
                      <Text style={styles.buttonText}>Add {formatMemberName(m)}</Text>
                    </TouchableOpacity>
                  ))}
              </View>
            </View>
            <TouchableOpacity style={[styles.button, styles.carAddButton]} onPress={() => onAddCarRental()} testID="car-rental-add">
              <Text style={styles.buttonText}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
};

export default CarRentalsPanel;
