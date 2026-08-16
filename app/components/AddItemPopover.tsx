import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

export type AddItemKind = 'activity' | 'place' | 'note' | 'checklist';

export type AddItemPopoverProps = {
  visible: boolean;
  onSelect: (kind: AddItemKind) => void;
  onClose: () => void;
  // 'place' | 'note' | 'checklist' all send a `kind` to POST /api/itineraries/details, which
  // 403s when itinerary_item_kinds is disabled server-side ('activity' never sends a kind, so
  // it's unaffected). Rather than let picking one of those three reach that 403 — surfaced as a
  // "Permission Denied" popup by the global interceptor — the caller hides them from this menu
  // entirely when the flag is off, leaving only "Add a custom activity" selectable.
  hiddenKinds?: AddItemKind[];
};

const OPTIONS: Array<{ kind: AddItemKind; icon: string; label: string; description: string }> = [
  { kind: 'place', icon: '📍', label: 'Add a place', description: 'A location, sight, or address' },
  { kind: 'note', icon: '📝', label: 'Add a note', description: 'Free-form text for the day' },
  { kind: 'checklist', icon: '✅', label: 'Add a checklist', description: 'A title with toggleable items' },
  { kind: 'activity', icon: '🗓️', label: 'Add a custom activity', description: 'Time + activity + cost' },
];

const AddItemPopover: React.FC<AddItemPopoverProps> = ({ visible, onSelect, onClose, hiddenKinds }) => {
  const visibleOptions = hiddenKinds?.length ? OPTIONS.filter((opt) => !hiddenKinds.includes(opt.kind)) : OPTIONS;
  return (
  <Modal
    visible={visible}
    transparent
    animationType="fade"
    onRequestClose={onClose}
    accessibilityViewIsModal
  >
    <Pressable style={styles.overlay} onPress={onClose} testID="add-item-popover-overlay">
      <Pressable
        style={styles.menu}
        onPress={(e: { stopPropagation: () => void }) => e.stopPropagation()}
        accessibilityRole="menu"
        testID="add-item-popover"
      >
        <Text style={styles.title}>Add to itinerary</Text>
        {visibleOptions.map((opt) => (
          <Pressable
            key={opt.kind}
            testID={`add-item-option-${opt.kind}`}
            accessibilityRole="menuitem"
            accessibilityLabel={opt.label}
            onPress={() => onSelect(opt.kind)}
            style={({ pressed }: { pressed: boolean }) => [styles.option, pressed && styles.optionPressed]}
          >
            <Text style={styles.optionIcon}>{opt.icon}</Text>
            <View style={styles.optionTextWrap}>
              <Text style={styles.optionLabel}>{opt.label}</Text>
              <Text style={styles.optionDescription}>{opt.description}</Text>
            </View>
          </Pressable>
        ))}
        <Pressable
          testID="add-item-option-cancel"
          style={({ pressed }: { pressed: boolean }) => [styles.cancel, pressed && styles.cancelPressed]}
          onPress={onClose}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </Pressable>
    </Pressable>
  </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  menu: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1f2937',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 12,
  },
  optionPressed: {
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  optionIcon: {
    fontSize: 20,
    width: 28,
    textAlign: 'center',
  },
  optionTextWrap: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  optionDescription: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  cancel: {
    marginTop: 6,
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  cancelPressed: {
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
});

export default AddItemPopover;
