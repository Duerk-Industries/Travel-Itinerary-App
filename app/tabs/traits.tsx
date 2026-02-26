import React, { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { TraitRecord } from './traitsLogic';
import {
  PROMPT_CAR_OPTIONS,
  PROMPT_COMFORT_OPTIONS,
  PROMPT_INTERACTION_STYLE_OPTIONS,
  PROMPT_INTEREST_OPTIONS,
  PROMPT_MOBILITY_OPTIONS,
  PROMPT_PACE_OPTIONS,
  PROMPT_PROFILE_TRAIT_NAME,
  extractPromptTraitsFromTraits,
  normalizePromptTraits,
  serializePromptTraits,
  type PromptInterestWeights,
  type PromptPaceCode,
  type PromptMobilityCode,
} from '../utils/promptTraits';

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
  setTraits: _setTraits,
  selectedTraitNames: _selectedTraitNames,
  setSelectedTraitNames: _setSelectedTraitNames,
  traitAge,
  setTraitAge,
  traitGender,
  setTraitGender,
  newTraitName: _newTraitName,
  setNewTraitName: _setNewTraitName,
  headers,
  jsonHeaders,
  fetchTraits,
  fetchTraitProfile,
  styles,
}: TraitsTabProps<T>) {
  const storedPromptProfile = useMemo(() => extractPromptTraitsFromTraits(traits), [traits]);
  const [promptTraits, setPromptTraits] = useState(() => normalizePromptTraits(storedPromptProfile.profile));
  const [customInterest, setCustomInterest] = useState('');

  const promptTraitsDigest = useMemo(() => serializePromptTraits(storedPromptProfile.profile), [storedPromptProfile.profile]);
  useEffect(() => {
    setPromptTraits(normalizePromptTraits(storedPromptProfile.profile));
  }, [promptTraitsDigest]);

  const setTripWeight = (key: keyof PromptInterestWeights, raw: string) => {
    const value = raw.replace(/[^0-9]/g, '');
    setPromptTraits((prev) => ({
      ...prev,
      tt: {
        ...prev.tt,
        w: {
          ...prev.tt.w,
          [key]: value.length ? Number(value) : 0,
        },
      },
    }));
  };

  const toggleInterest = (interest: string) => {
    setPromptTraits((prev) => {
      const current = new Set(prev.ut.i);
      if (current.has(interest)) current.delete(interest);
      else current.add(interest);
      return { ...prev, ut: { ...prev.ut, i: Array.from(current) } };
    });
  };

  const addCustomInterest = () => {
    const normalized = customInterest.trim();
    if (!normalized) return;
    setPromptTraits((prev) => ({
      ...prev,
      ut: { ...prev.ut, i: Array.from(new Set([...prev.ut.i, normalized])) },
    }));
    setCustomInterest('');
  };

  const saveTraitSelections = async () => {
    if (!userToken) return;
    if (!traitAge.trim() || Number(traitAge) <= 0) {
      alert('Enter your age to continue.');
      return;
    }
    if (!traitGender) {
      alert('Select a gender option.');
      return;
    }
    const normalizedPromptTraits = normalizePromptTraits(promptTraits);
    const promptProfileBody = {
      name: PROMPT_PROFILE_TRAIT_NAME,
      level: 5,
      notes: serializePromptTraits(normalizedPromptTraits),
    };

    const profileUrl = storedPromptProfile.traitId
      ? `${backendUrl}/api/traits/${storedPromptProfile.traitId}`
      : `${backendUrl}/api/traits`;
    const profileMethod = storedPromptProfile.traitId ? 'PATCH' : 'POST';
    const profileRes = await fetch(profileUrl, {
      method: profileMethod,
      headers: jsonHeaders,
      body: JSON.stringify(promptProfileBody),
    }).catch(() => null);
    if (!profileRes || !profileRes.ok) {
      const data = await profileRes?.json().catch(() => ({}));
      alert(data?.error || 'Unable to save itinerary preference profile');
      return;
    }

    await fetch(`${backendUrl}/api/traits/profile/demographics`, {
      method: 'POST',
      headers: jsonHeaders,
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
        <Text style={styles.sectionTitle}>Traveler Profile</Text>
        <Text style={styles.helperText}>These demographics are optional context for shared planning features.</Text>
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
      </View>

      <View style={[styles.card, styles.traitsSection]}>
        <Text style={styles.sectionTitle}>Itinerary Preferences</Text>
        <Text style={styles.helperText}>These map directly to prompt-plan `tt/ut` fields used by itinerary generation.</Text>

        <Text style={styles.modalLabel}>Pace</Text>
        <View style={styles.traitGrid}>
          {PROMPT_PACE_OPTIONS.map((opt) => {
            const selected = promptTraits.tt.p === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.traitChip, selected && styles.traitChipSelected]}
                onPress={() => setPromptTraits((prev) => ({ ...prev, tt: { ...prev.tt, p: opt.value } }))}
              >
                <Text style={[styles.traitChipText, selected && styles.traitChipTextSelected]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.modalLabel}>Comfort</Text>
        <View style={styles.traitGrid}>
          {PROMPT_COMFORT_OPTIONS.map((opt) => {
            const selected = promptTraits.tt.c === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.traitChip, selected && styles.traitChipSelected]}
                onPress={() => setPromptTraits((prev) => ({ ...prev, tt: { ...prev.tt, c: opt.value } }))}
              >
                <Text style={[styles.traitChipText, selected && styles.traitChipTextSelected]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.modalLabel}>Mobility</Text>
        <View style={styles.traitGrid}>
          {PROMPT_MOBILITY_OPTIONS.map((opt) => {
            const selected = promptTraits.tt.mob === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.traitChip, selected && styles.traitChipSelected]}
                onPress={() => setPromptTraits((prev) => ({ ...prev, tt: { ...prev.tt, mob: opt.value } }))}
              >
                <Text style={[styles.traitChipText, selected && styles.traitChipTextSelected]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.modalLabel}>Car Preference</Text>
        <View style={styles.traitGrid}>
          {PROMPT_CAR_OPTIONS.map((opt) => {
            const selected = promptTraits.tt.car === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.traitChip, selected && styles.traitChipSelected]}
                onPress={() => setPromptTraits((prev) => ({ ...prev, tt: { ...prev.tt, car: opt.value } }))}
              >
                <Text style={[styles.traitChipText, selected && styles.traitChipTextSelected]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.modalLabel}>Interaction Style</Text>
        <View style={styles.traitGrid}>
          {PROMPT_INTERACTION_STYLE_OPTIONS.map((opt) => {
            const selected = promptTraits.tt.is === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.traitChip, selected && styles.traitChipSelected]}
                onPress={() => setPromptTraits((prev) => ({ ...prev, tt: { ...prev.tt, is: opt.value } }))}
              >
                <Text style={[styles.traitChipText, selected && styles.traitChipTextSelected]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.modalLabel}>Interest Weights (%)</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { minWidth: 120 }]}
            placeholder="Outdoors"
            keyboardType="numeric"
            value={String(promptTraits.tt.w.outdoors)}
            onChangeText={(text: string) => setTripWeight('outdoors', text)}
          />
          <TextInput
            style={[styles.input, { minWidth: 120 }]}
            placeholder="Adventure"
            keyboardType="numeric"
            value={String(promptTraits.tt.w.adventure)}
            onChangeText={(text: string) => setTripWeight('adventure', text)}
          />
          <TextInput
            style={[styles.input, { minWidth: 120 }]}
            placeholder="Culture"
            keyboardType="numeric"
            value={String(promptTraits.tt.w.culture)}
            onChangeText={(text: string) => setTripWeight('culture', text)}
          />
          <TextInput
            style={[styles.input, { minWidth: 120 }]}
            placeholder="Food"
            keyboardType="numeric"
            value={String(promptTraits.tt.w.food)}
            onChangeText={(text: string) => setTripWeight('food', text)}
          />
          <TextInput
            style={[styles.input, { minWidth: 120 }]}
            placeholder="Nightlife"
            keyboardType="numeric"
            value={String(promptTraits.tt.w.nightlife)}
            onChangeText={(text: string) => setTripWeight('nightlife', text)}
          />
          <TextInput
            style={[styles.input, { minWidth: 120 }]}
            placeholder="Relax"
            keyboardType="numeric"
            value={String(promptTraits.tt.w.relax)}
            onChangeText={(text: string) => setTripWeight('relax', text)}
          />
          <TextInput
            style={[styles.input, { minWidth: 120 }]}
            placeholder="Photography"
            keyboardType="numeric"
            value={String(promptTraits.tt.w.photography)}
            onChangeText={(text: string) => setTripWeight('photography', text)}
          />
          <TextInput
            style={[styles.input, { minWidth: 120 }]}
            placeholder="Authentic/Local"
            keyboardType="numeric"
            value={String(promptTraits.tt.w.authentic_local)}
            onChangeText={(text: string) => setTripWeight('authentic_local', text)}
          />
          <TextInput
            style={[styles.input, { minWidth: 120 }]}
            placeholder="Iconic Landmarks"
            keyboardType="numeric"
            value={String(promptTraits.tt.w.iconic_landmarks)}
            onChangeText={(text: string) => setTripWeight('iconic_landmarks', text)}
          />
        </View>

        <Text style={styles.modalLabel}>Interests (`ut.i`)</Text>
        <View style={styles.traitGrid}>
          {PROMPT_INTEREST_OPTIONS.map((interest) => {
            const selected = promptTraits.ut.i.includes(interest);
            return (
              <TouchableOpacity
                key={interest}
                style={[styles.traitChip, selected && styles.traitChipSelected]}
                onPress={() => toggleInterest(interest)}
              >
                <Text style={[styles.traitChipText, selected && styles.traitChipTextSelected]}>{interest}</Text>
              </TouchableOpacity>
            );
          })}
          {promptTraits.ut.i
            .filter((interest) => !PROMPT_INTEREST_OPTIONS.includes(interest))
            .map((interest) => (
              <TouchableOpacity
                key={interest}
                style={[styles.traitChip, styles.traitChipSelected]}
                onPress={() => toggleInterest(interest)}
              >
                <Text style={[styles.traitChipText, styles.traitChipTextSelected]}>{interest}</Text>
              </TouchableOpacity>
            ))}
        </View>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Custom interest"
            value={customInterest}
            onChangeText={setCustomInterest}
          />
          <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={addCustomInterest}>
            <Text style={styles.buttonText}>Add</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.modalLabel}>User Overrides (`ut`)</Text>
        <Text style={styles.helperText}>Optional overrides for pace/mobility, plus early-bird and night-owl flags.</Text>
        <View style={styles.traitGrid}>
          <TouchableOpacity
            style={[styles.traitChip, !promptTraits.ut.po && styles.traitChipSelected]}
            onPress={() => setPromptTraits((prev) => ({ ...prev, ut: { ...prev.ut, po: undefined } }))}
          >
            <Text style={[styles.traitChipText, !promptTraits.ut.po && styles.traitChipTextSelected]}>Use Trip Pace</Text>
          </TouchableOpacity>
          {PROMPT_PACE_OPTIONS.map((opt) => {
            const selected = promptTraits.ut.po === opt.value;
            return (
              <TouchableOpacity
                key={`ut-po-${opt.value}`}
                style={[styles.traitChip, selected && styles.traitChipSelected]}
                onPress={() => setPromptTraits((prev) => ({ ...prev, ut: { ...prev.ut, po: opt.value as PromptPaceCode } }))}
              >
                <Text style={[styles.traitChipText, selected && styles.traitChipTextSelected]}>{opt.label} Override</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.traitGrid}>
          <TouchableOpacity
            style={[styles.traitChip, !promptTraits.ut.mob && styles.traitChipSelected]}
            onPress={() => setPromptTraits((prev) => ({ ...prev, ut: { ...prev.ut, mob: undefined } }))}
          >
            <Text style={[styles.traitChipText, !promptTraits.ut.mob && styles.traitChipTextSelected]}>
              Use Trip Mobility
            </Text>
          </TouchableOpacity>
          {PROMPT_MOBILITY_OPTIONS.map((opt) => {
            const selected = promptTraits.ut.mob === opt.value;
            return (
              <TouchableOpacity
                key={`ut-mob-${opt.value}`}
                style={[styles.traitChip, selected && styles.traitChipSelected]}
                onPress={() =>
                  setPromptTraits((prev) => ({ ...prev, ut: { ...prev.ut, mob: opt.value as PromptMobilityCode } }))
                }
              >
                <Text style={[styles.traitChipText, selected && styles.traitChipTextSelected]}>{opt.label} Override</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.traitGrid}>
          <TouchableOpacity
            style={[styles.traitChip, promptTraits.ut.eb && styles.traitChipSelected]}
            onPress={() => setPromptTraits((prev) => ({ ...prev, ut: { ...prev.ut, eb: !prev.ut.eb } }))}
          >
            <Text style={[styles.traitChipText, promptTraits.ut.eb && styles.traitChipTextSelected]}>Early Bird</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.traitChip, promptTraits.ut.no && styles.traitChipSelected]}
            onPress={() => setPromptTraits((prev) => ({ ...prev, ut: { ...prev.ut, no: !prev.ut.no } }))}
          >
            <Text style={[styles.traitChipText, promptTraits.ut.no && styles.traitChipTextSelected]}>Night Owl</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.traitGrid}>
          <TouchableOpacity style={styles.button} onPress={saveTraitSelections}>
            <Text style={styles.buttonText}>Save Preferences</Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
}
