import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Modal from './KeyboardAwareModal';
import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';

type PickerLocation = { id: string; name: string; sourceType?: string; countryName?: string };

type TemplateImage = { url: string; width: number; height: number; credit: string; pageUrl: string };

type TemplateSummary = {
  id: string;
  title: string;
  summary: string;
  days: number;
  route: string;
  cities: string[];
  highlights: string[];
  imageQuery: string;
  matchedCities?: string[];
  /** Our stored public-domain picture; when absent the card falls back to an image search on imageQuery. */
  heroImage?: TemplateImage | null;
};

type PreviewItem = { kind: 'stay' | 'activity' | 'transfer'; time: string; title: string; detail: string; needsBooking: boolean; description?: string; image?: TemplateImage | null };
type TemplateDestinationInfo = { key: string; name: string; description: string; images: TemplateImage[] };
type TemplateDetail = TemplateSummary & { preview: Array<{ day: number; base: string; items: PreviewItem[] }>; destinations?: TemplateDestinationInfo[] };

type Props = {
  backendUrl: string;
  headers: Record<string, string>;
  selectedLocations: PickerLocation[];
  /** The dates the traveler already entered, YYYY-MM-DD, or empty. With a start date the plan is dated. */
  startDate: string;
  /** Set when startDate is only a placeholder (the 1st of a chosen month): the plan's dates then follow real dates later. */
  startMonth?: number | null;
  endDate?: string;
  /** The trip's length in days, from its dates or from "Dates not set"; templates longer than this are not offered. */
  tripDays?: number | null;
  tripName: string;
  styles: Record<string, any>;
  onCreated: (tripId: string) => void;
  onUnauthorized?: () => void;
};

const endDateFor = (startDate: string, days: number): string => {
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days - 1);
  return d.toISOString().slice(0, 10);
};

/** Names the destination search results carry, which is how the server matches templates to what was chosen. */
export const destinationQuery = (locations: PickerLocation[], maxDays?: number | null): string => {
  const countries = new Set<string>();
  const cities = new Set<string>();
  for (const location of locations) {
    if (location.sourceType === 'country') countries.add(location.name);
    else if (location.countryName) countries.add(location.countryName);
    if (location.sourceType === 'city' || location.sourceType === 'destination') cities.add(location.name);
  }
  const params = new URLSearchParams();
  params.set('locationIds', locations.map((location) => location.id).join(','));
  if (countries.size) params.set('countries', [...countries].join(','));
  if (cities.size) params.set('cities', [...cities].join(','));
  if (maxDays && maxDays > 0) params.set('maxDays', String(Math.floor(maxDays)));
  return params.toString();
};

/**
 * Itinerary templates for the destination the traveler chose. Shows nothing at all unless a template
 * is aligned with that destination. Choosing one opens a day-by-day preview; "Use this template"
 * creates the trip, which then opens like any other and can be edited freely.
 */
const TripTemplatePicker: React.FC<Props> = ({ backendUrl, headers, selectedLocations, startDate, startMonth, endDate, tripDays, tripName, styles, onCreated, onUnauthorized }) => {
  const _styleTheme = useStyleTheme();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [images, setImages] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const query = useMemo(() => (selectedLocations.length ? destinationQuery(selectedLocations, tripDays) : ''), [selectedLocations, tripDays]);
  // A template can be used with a start date, or, without one, when the trip's length can hold it.
  // Each destination is introduced once, on the first day the traveler is there; the country (no "/" in its key) opens Day 1.
  const destinationsByDay: Record<number, TemplateDestinationInfo[]> = {};
  (detail?.destinations ?? []).forEach((destination) => {
    const name = destination.name.toLowerCase();
    const day = destination.key.includes('/')
      ? detail?.preview.find((d) => d.base?.toLowerCase() === name)
        ?? detail?.preview.find((d) => d.items.some((item) => `${item.title} ${item.detail}`.toLowerCase().includes(name)))
      : undefined;
    const dayNumber = day?.day ?? detail?.preview[0]?.day;
    if (dayNumber !== undefined) (destinationsByDay[dayNumber] ??= []).push(destination);
  });
  const canUse = Boolean(detail && (startDate || (tripDays && tripDays >= detail.days)));

  useEffect(() => {
    let cancelled = false;
    setTemplates([]);
    if (!query) return undefined;
    (async () => {
      try {
        const res = await fetch(`${backendUrl}/api/trip-templates?${query}`, { headers });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (!cancelled && Array.isArray(data.templates)) setTemplates(data.templates);
      } catch {
        // No templates is the same as none being offered.
      }
    })();
    return () => { cancelled = true; };
  }, [backendUrl, headers, query]);

  // A picture where one is available; a card without one is simply text.
  useEffect(() => {
    let cancelled = false;
    templates.forEach((template) => {
      if (template.heroImage || !template.imageQuery || images[template.id]) return;
      (async () => {
        try {
          const res = await fetch(`${backendUrl}/api/itinerary/images?location=${encodeURIComponent(template.imageQuery)}`, { headers });
          const data = await res.json().catch(() => ({}));
          if (!cancelled && res.ok && data.url && data.provider !== 'placeholder') setImages((current) => ({ ...current, [template.id]: String(data.url) }));
        } catch {
          // No picture.
        }
      })();
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, backendUrl, headers]);

  const openPreview = async (template: TemplateSummary) => {
    setError('');
    setLoadingDetail(true);
    setDetail({ ...template, preview: [] });
    try {
      const res = await fetch(`${backendUrl}/api/trip-templates/${encodeURIComponent(template.id)}`, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'This template could not be loaded.');
      setDetail({ ...template, ...data });
    } catch (err) {
      setDetail(null);
      setError((err as Error).message || 'This template could not be loaded.');
    } finally {
      setLoadingDetail(false);
    }
  };

  const useTemplate = async () => {
    if (!detail || !canUse || creating) return;
    setCreating(true);
    setError('');
    try {
      const res = await fetch(`${backendUrl}/api/trip-templates/${encodeURIComponent(detail.id)}/trip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          name: tripName.trim() || undefined,
          ...(startDate ? { startDate, endDate: endDate || undefined, ...(startMonth ? { startMonth, startYear: Number(startDate.slice(0, 4)) } : {}) } : { durationDays: tripDays }),
          locationIds: selectedLocations.map((location) => location.id),
          participants: [],
        }),
      });
      if (res.status === 401) {
        onUnauthorized?.();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.trip?.id) {
        setError(data.error || 'The trip could not be created from this template.');
        return;
      }
      setDetail(null);
      onCreated(String(data.trip.id));
    } catch (err) {
      setError((err as Error).message || 'The trip could not be created from this template.');
    } finally {
      setCreating(false);
    }
  };

  if (!templates.length) return null;
  const theme = _styleTheme;

  return (
    <View testID="trip-templates">
      <Text style={styles.modalLabel}>Or start from a template</Text>
      <Text style={styles.helperText}>Ready-made plans for your destination. Pick one to preview it, then change anything you like.</Text>
      {templates.map((template) => (
        <TouchableOpacity
          key={template.id}
          testID={`trip-template-card-${template.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Preview ${template.title}`}
          style={themeStyle('components_TripTemplatePicker_1', {}, theme)}
          onPress={() => { void openPreview(template); }}
        >
          {template.heroImage || images[template.id] ? <Image source={{ uri: template.heroImage?.url ?? images[template.id] }} accessibilityIgnoresInvertColors accessibilityLabel={template.title} style={themeStyle('components_TripTemplatePicker_2', {}, theme)} /> : null}
          {template.heroImage ? <Text testID={`trip-template-credit-${template.id}`} style={[styles.helperText, themeStyle('components_TripTemplatePicker_15', {}, theme)]}>Photo: {template.heroImage.credit}</Text> : null}
          <View style={themeStyle('components_TripTemplatePicker_3', {}, theme)}>
            <Text style={styles.headerText}>{template.title}</Text>
            <Text style={styles.helperText}>{template.route}</Text>
            {template.summary ? <Text style={styles.bodyText}>{template.summary}</Text> : null}
            <View style={themeStyle('components_TripTemplatePicker_4', {}, theme)}>
              {template.highlights.slice(0, 4).map((highlight) => (
                <View key={highlight} style={themeStyle('components_TripTemplatePicker_5', {}, theme)}>
                  <Text style={styles.helperText}>{highlight}</Text>
                </View>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      ))}
      {error && !detail ? <Text style={styles.errorText}>{error}</Text> : null}

      <Modal visible={Boolean(detail)} animationType="slide" onRequestClose={() => setDetail(null)}>
        <View style={themeStyle('components_TripTemplatePicker_6', {}, theme)} testID="trip-template-preview">
          <View style={themeStyle('components_TripTemplatePicker_7', {}, theme)}>
            <Text style={styles.sectionTitle}>{detail?.title}</Text>
            <TouchableOpacity testID="trip-template-close" accessibilityRole="button" accessibilityLabel="Close preview" onPress={() => setDetail(null)}>
              <Text style={styles.linkText ?? styles.buttonText}>Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView>
            {detail?.summary ? <Text style={styles.bodyText}>{detail.summary}</Text> : null}
            <Text style={styles.helperText}>{detail?.days} days · {detail?.route}</Text>
            <Text style={styles.helperText}>Hotels are placeholders: you choose where to stay. Anything marked "Book ahead" sells out, so book it early.</Text>
            {loadingDetail ? <ActivityIndicator /> : null}
            {detail?.preview.map((day) => (
              <View key={day.day} testID={`trip-template-day-${day.day}`}>
                <View style={themeStyle('components_TripTemplatePicker_8', {}, theme)}>
                  <Text style={styles.headerText}>Day {day.day}{day.base ? ` · ${day.base}` : ''}</Text>
                </View>
                {(destinationsByDay[day.day] ?? []).map((destination) => (
                  <View key={destination.key} style={themeStyle('components_TripTemplatePicker_9', {}, theme)} testID={`trip-template-destination-${destination.key}`}>
                    {destination.images[0] ? <Image source={{ uri: destination.images[0].url }} accessibilityIgnoresInvertColors accessibilityLabel={destination.name} style={themeStyle('components_TripTemplatePicker_17', {}, theme)} /> : null}
                    <View style={themeStyle('components_TripTemplatePicker_11', {}, theme)}>
                      <Text style={styles.headerText}>{destination.name}</Text>
                      {destination.description ? <Text style={styles.helperText}>{destination.description}</Text> : null}
                      {destination.images[0] ? <Text style={[styles.helperText, themeStyle('components_TripTemplatePicker_15', {}, theme)]}>Photo: {destination.images[0].credit}</Text> : null}
                    </View>
                  </View>
                ))}
                {day.items.map((item, index) => (
                  <View key={`${day.day}-${index}`} style={themeStyle('components_TripTemplatePicker_9', {}, theme)}>
                    <Text style={[styles.helperText, themeStyle('components_TripTemplatePicker_10', {}, theme)]}>{item.time}</Text>
                    {item.image ? <Image source={{ uri: item.image.url }} accessibilityIgnoresInvertColors accessibilityLabel={item.title} style={themeStyle('components_TripTemplatePicker_16', {}, theme)} /> : null}
                    <View style={themeStyle('components_TripTemplatePicker_11', {}, theme)}>
                      <Text style={styles.bodyText}>{item.title}</Text>
                      {item.detail ? <Text style={styles.helperText}>{item.detail}</Text> : null}
                      {item.description ? <Text style={styles.helperText}>{item.description}</Text> : null}
                      {item.image ? <Text style={[styles.helperText, themeStyle('components_TripTemplatePicker_15', {}, theme)]}>Photo: {item.image.credit}</Text> : null}
                      {item.needsBooking ? <Text style={themeStyle('components_TripTemplatePicker_12', {}, theme)}>Book ahead</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
          <View style={themeStyle('components_TripTemplatePicker_13', {}, theme)}>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {startDate && detail ? (
              <Text style={styles.helperText}>{startDate} to {endDate && endDate > endDateFor(startDate, detail.days) ? endDate : endDateFor(startDate, detail.days)}</Text>
            ) : canUse ? (
              <Text style={styles.helperText} testID="trip-template-undated">No dates yet: this fills Day 1 to Day {detail?.days} of your {tripDays}-day trip. Set dates later and the days stay as they are.</Text>
            ) : (
              <Text style={styles.helperText} testID="trip-template-needs-date">Set a start date or a trip length of at least {detail?.days} days to use this template.</Text>
            )}
            <TouchableOpacity
              testID={detail ? `trip-template-use-${detail.id}` : 'trip-template-use'}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canUse || creating || loadingDetail }}
              disabled={!canUse || creating || loadingDetail}
              style={[styles.button, !canUse || creating || loadingDetail ? themeStyle('components_TripTemplatePicker_14', {}, theme) : null]}
              onPress={() => { void useTemplate(); }}
            >
              <Text style={styles.buttonText}>{creating ? 'Creating…' : 'Use this template'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default TripTemplatePicker;
