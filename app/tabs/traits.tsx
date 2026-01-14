import React from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { traitOptions, toggleTraitState, type TraitRecord } from './traitsLogic';

export type Trait = TraitRecord;

type TraitsTabProps<T extends TraitRecord> = {
  backendUrl: string;
  userToken: string | null;
  traits: T[];
  setTraits: React.Dispatch<React.SetStateAction<T[]>>;
  selectedTraitNames: Set<string>;
  setSelectedTraitNames: React.Dispatch<React.SetStateAction<Set<string>>>;
  traitAge: string;
  setTraitAge: React.Dispatch<React.SetStateAction<string>>;
  traitGender: 'female' | 'male' | 'nonbinary' | 'prefer-not';
  setTraitGender: React.Dispatch<React.SetStateAction<'female' | 'male' | 'nonbinary' | 'prefer-not'>>;
  newTraitName: string;
  setNewTraitName: React.Dispatch<React.SetStateAction<string>>;
  headers: Record<string, string>;
  jsonHeaders: Record<string, string>;
  fetchTraits: () => Promise<void>;
  fetchTraitProfile: () => Promise<void>;
  styles: any;
};

export function TraitsTab<T extends TraitRecord>({
  backendUrl,
  userToken,
  traits,
  setTraits,
  selectedTraitNames,
  setSelectedTraitNames,
  traitAge,
  setTraitAge,
  traitGender,
  setTraitGender,
  newTraitName,
  setNewTraitName,
  headers,
  jsonHeaders,
  fetchTraits,
  fetchTraitProfile,
  styles,
}: TraitsTabProps<T>) {
  const createTrait = async () => {
    if (!newTraitName.trim()) {
      alert('Enter a trait name');
      return;
    }
    try {
      const res = await fetch(`${backendUrl}/api/traits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ name: newTraitName.trim(), level: 3 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Unable to save trait');
        return;
      }
      setTraits((prev) => [...prev, { id: data.id ?? newTraitName.trim(), name: newTraitName.trim() } as T]);
      setSelectedTraitNames((prev) => {
        const next = new Set(prev);
        next.add(newTraitName.trim());
        return next;
      });
      setNewTraitName('');
    } catch (err: any) {
      alert(err.message || 'Unable to save trait');
    }
  };

  const deleteTrait = async (traitId: string) => {
    const res = await fetch(`${backendUrl}/api/traits/${traitId}`, { method: 'DELETE', headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to delete trait');
      return false;
    }
    return true;
  };

  const toggleTrait = async (name: string) => {
    const { nextSelected, nextTraits, removedTrait } = toggleTraitState(
      { traits, selected: selectedTraitNames },
      name,
      traitOptions
    );
    setSelectedTraitNames(nextSelected);
    setTraits(nextTraits as T[]);
    if (removedTrait?.id) {
      await deleteTrait(removedTrait.id);
    }
  };

  const saveTraitSelections = async () => {
    if (!userToken) return;
    const selected = new Set(selectedTraitNames);
    const existingByName = new Map(traits.map((t) => [t.name, t]));
    for (const t of traits) {
      if (!selected.has(t.name) && t.id) {
        await deleteTrait(t.id);
      }
    }
    for (const name of selected) {
      if (!existingByName.has(name)) {
        await fetch(`${backendUrl}/api/traits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ name, level: 3 }),
        }).catch(() => undefined);
      }
    }
    await fetch(`${backendUrl}/api/traits/profile/demographics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        age: traitAge ? Number(traitAge) : null,
        gender: traitGender,
      }),
    }).catch(() => undefined);
    fetchTraitProfile();
    fetchTraits();
    alert('Traits saved');
  };

  return (
    <>
      <View style={[styles.card, styles.traitsSection]}>
        <Text style={styles.sectionTitle}>Traits</Text>
        <Text style={styles.helperText}>
          Capture travel personality markers to tailor itinerary ideas (e.g., Adventurous, Coffee Lover, Beach Bum).
        </Text>
        <TextInput style={styles.input} placeholder="Trait name" value={newTraitName} onChangeText={setNewTraitName} />
        <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={createTrait}>
          <Text style={styles.buttonText}>Save Trait</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, styles.traitsSection]}>
        <Text style={styles.sectionTitle}>Select as many user traits that fit your travel style</Text>
        <Text style={styles.helperText}>These help personalize suggestions and itineraries.</Text>
        <TextInput
          style={styles.input}
          placeholder="Age"
          keyboardType="numeric"
          value={traitAge}
          onChangeText={(text: string) => setTraitAge(text.replace(/[^0-9]/g, ''))}
        />
        <View style={styles.traitGrid}>
          {[
            { key: 'female', label: 'Female' },
            { key: 'male', label: 'Male' },
            { key: 'nonbinary', label: 'Non-binary' },
            { key: 'prefer-not', label: 'Prefer not to say' },
          ].map((opt) => {
            const selected = traitGender === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.traitChip, selected && styles.traitChipSelected]}
                onPress={() => setTraitGender(opt.key as typeof traitGender)}
              >
                <Text style={[styles.traitChipText, selected && styles.traitChipTextSelected]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.traitGrid}>
          {[...traitOptions, ...traits.filter((t) => !traitOptions.includes(t.name)).map((t) => t.name)].map((name) => {
            const selected = selectedTraitNames.has(name);
            const isCustom = !traitOptions.includes(name);
            return (
              <TouchableOpacity
                key={name}
                style={[styles.traitChip, selected && styles.traitChipSelected]}
                onPress={() => toggleTrait(name)}
              >
                <Text style={[styles.traitChipText, selected && styles.traitChipTextSelected]}>
                  {isCustom ? `${name} (custom*)` : name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity style={styles.button} onPress={saveTraitSelections}>
          <Text style={styles.buttonText}>Save Traits</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}
