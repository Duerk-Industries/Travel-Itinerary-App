// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

const TripBlogTab = ({ backendUrl, headers, activeTripId, styles, readOnly = false }) => {
  const [blog, setBlog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState({});

  const load = async () => {
    if (!activeTripId) return;
    setLoading(true);
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog`, { headers });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to load trip blog');
      const data = await response.json();
      setBlog(data);
      const next = {};
      (data.days || []).forEach((day) => (day.items || []).forEach((item) => { next[item.id] = item.body; }));
      setDrafts(next);
    } catch (error) {
      Alert.alert('Trip blog', error.message || 'Unable to load trip blog');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [activeTripId]);

  const save = async (item) => {
    setSaving(true);
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/items/${item.id}`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', 'If-Match': String(item.version) },
        body: JSON.stringify({ body: drafts[item.id] ?? '', version: item.version }),
      });
      if (response.status === 409) throw new Error('Someone else edited this block. Reload to resolve the conflict.');
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to save');
      await load();
    } catch (error) { Alert.alert('Trip blog', error.message || 'Unable to save'); }
    finally { setSaving(false); }
  };

  if (!activeTripId) return <View style={styles.card}><Text style={styles.sectionTitle}>Select a trip to write its blog.</Text></View>;
  if (loading) return <View style={styles.card}><ActivityIndicator /></View>;
  return (
    <ScrollView contentContainerStyle={{ padding: 12 }}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{blog?.title || 'Trip Blog'}</Text>
        <Text style={{ opacity: 0.7, marginBottom: 12 }}>A shared story for everyone on the trip.</Text>
        {(blog?.days || []).map((day) => (
          <View key={day.id} style={{ marginBottom: 20 }}>
            <Text style={styles.sectionTitle}>{day.localDate}</Text>
            {(day.items || []).map((item) => (
              <View key={item.id} style={{ marginTop: 8 }}>
                <TextInput
                  multiline value={drafts[item.id] ?? item.body}
                  editable={!readOnly} onChangeText={(value) => setDrafts((current) => ({ ...current, [item.id]: value }))}
                  placeholder="What happened today?" style={{ minHeight: 90, borderWidth: 1, borderColor: '#ccd', borderRadius: 8, padding: 10, textAlignVertical: 'top' }}
                />
                {!readOnly ? <TouchableOpacity style={[styles.button, { marginTop: 6 }]} disabled={saving} onPress={() => save(item)}><Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save'}</Text></TouchableOpacity> : null}
              </View>
            ))}
            {!readOnly && (day.items || []).length === 0 ? <Text style={{ opacity: 0.7 }}>No entry yet. Add one from the API or mobile composer.</Text> : null}
          </View>
        ))}
      </View>
    </ScrollView>
  );
};

export default TripBlogTab;
