import IconText from './IconText';
import { keepsakeLoadingHtml, themeStyle } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import KeepsakeMapCaptureHost from './KeepsakeMapCaptureHost';
import type { KeepsakeMapCaptureHandle } from './KeepsakeMapCaptureHost.types';
import { keepsakeMapFallback } from '../utils/keepsakeMapData';
import { captureKeepsakeMap, type KeepsakeMapCapture } from '../utils/keepsakeMapCapture';
import type { BlogMapDay } from '../../server/src/services/blogMapService';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Platform, ScrollView, Share, Text, TouchableOpacity, View } from 'react-native';
import Modal from './KeyboardAwareModal';
import {
  KEEPSAKE_THEMES,
  buildKeepsakeHtml,
  getKeepsakeTheme,
  paragraphsFromRichText,
  type KeepsakeThemeKey,
} from '../utils/keepsake';

type Props = { backendUrl: string; headers: Record<string, string>; tripId: string; nativeEnabled?: boolean; textColor?: string };

const THEME_STORAGE_KEY = 'wb.keepsakeTheme';

const readSavedTheme = (): KeepsakeThemeKey => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return getKeepsakeTheme(window.localStorage.getItem(THEME_STORAGE_KEY)).key;
  } catch {
    // Storage unavailable (private window etc.): fall back to the default.
  }
  return getKeepsakeTheme(null).key;
};

const saveTheme = (key: KeepsakeThemeKey) => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(THEME_STORAGE_KEY, key);
  } catch {
    // Not critical: the choice just won't be remembered.
  }
};

// Plain-text version for phone builds without the PDF module (expo-print arrived in a later build).
const keepsakeText = (blog: any): string =>
  [
    blog.title || 'Trip keepsake',
    blog.subtitle,
    ...paragraphsFromRichText(blog.introduction),
    ...(blog.days || []).flatMap((day: any) => [
      day.headline || day.localDate,
      day.summary,
      ...(day.items || []).filter((item: any) => item.kindKey === 'core.text').flatMap((item: any) => paragraphsFromRichText(item.body)),
    ]),
  ].filter(Boolean).join('\n\n');

const BlogKeepsakeButton: React.FC<Props> = ({ backendUrl, headers, tripId, nativeEnabled = false, textColor: _textColorOverride }) => {
  const _styleTheme = useStyleTheme();
  const textColor = _textColorOverride ?? themeStyle('components_BlogKeepsakeButton_19', {  }, _styleTheme);
  const scope = `${backendUrl}:${tripId}:${JSON.stringify(headers)}`;
  const identity = useRef({scope}); if(identity.current.scope !== scope) identity.current={scope};
  const host = useRef<KeepsakeMapCaptureHandle>(null), lock = useRef<object|null>(null);
  const alive = useRef(true);
  useEffect(() => {setBusy(false);setChoosing(false);lock.current=null;},[scope]);
  useEffect(() => {alive.current=true;return () => {alive.current=false;};},[]);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [themeKey, setThemeKey] = useState<KeepsakeThemeKey>(readSavedTheme);

  const loadBlog = async () => {
    const response = await fetch(`${backendUrl}/api/trips/${tripId}/blog?limit=100`, { headers });
    const blog = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(blog.error || 'Unable to prepare keepsake');
    return blog;
  };

  const loadMaps = async (check: () => void): Promise<Record<string, KeepsakeMapCapture>> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(`${backendUrl}/api/trips/${tripId}/blog/maps?shared=1`, { headers, cache: 'no-store', signal: controller.signal });
      if (!response.ok) return {};
      const data = await response.json();
      const maps: Record<string, KeepsakeMapCapture> = {};
      // One bounded export renderer at a time; never preserve buffers on live maps.
      const days = (Array.isArray(data.days) ? data.days as BlogMapDay[] : []).slice(0, 60);
      for (const day of days) if (day.mapPoints?.precision === 'approximate') maps[day.dayDate] = keepsakeMapFallback(day.mapPoints);
      for (const day of days.slice(0, 6)) {
        check();
        if (day.mapPoints?.precision === 'approximate') maps[day.dayDate] = Platform.OS === 'web' ? await captureKeepsakeMap(day.mapPoints) : await host.current?.capture(day.mapPoints) ?? keepsakeMapFallback(day.mapPoints);
        check();
      }
      return maps;
    } catch { return {}; }
    finally { clearTimeout(timer); }
  };

  const createKeepsake = async () => {
    if (lock.current === identity.current) return;
    const operation = identity.current; lock.current=operation;
    const check = () => {if (!alive.current || identity.current !== operation) throw new Error('Keepsake export canceled.');};
    saveTheme(themeKey);
    setChoosing(false);
    setBusy(true);
    // Open the print tab now, inside the tap, so pop-up blockers allow it; fill it once loaded.
    const popup = Platform.OS === 'web' && typeof window !== 'undefined' ? window.open('', '_blank') : null;
    try {
      if (Platform.OS === 'web') {
        if (!popup) throw new Error('Allow pop-ups to open the print keepsake');
        popup.opener = null;
        popup.document.write(keepsakeLoadingHtml(_styleTheme));
        const blog = await loadBlog(); check(); check();
        popup.document.open();
        popup.document.write(buildKeepsakeHtml(blog, themeKey, await loadMaps(check)));
        popup.document.close();
        popup.focus();
        // Give photos and the web font a moment to load before the print dialog.
        await Promise.race([
          Promise.all([popup.document.fonts?.ready, ...Array.from(popup.document.images).map(image => image.complete ? Promise.resolve() : new Promise<void>(resolve => { image.onload = () => resolve(); image.onerror = () => resolve(); }))]),
          new Promise(resolve => window.setTimeout(resolve, 5_000)),
        ]);
        check(); if (!popup.closed) popup.print();
        return;
      }
      const blog = await loadBlog(); check();
      let Print: any = null;
      let Sharing: any = null;
      try {
        // Native modules, required lazily: older app builds don't include expo-print.
        Print = require('expo-print');
        Sharing = require('expo-sharing');
      } catch {
        Print = null;
      }
      if (Print?.printToFileAsync && Sharing?.shareAsync) {
        const maps = await loadMaps(check); check();
        const { uri } = await Print.printToFileAsync({ html: buildKeepsakeHtml(blog, themeKey, maps) }); check();
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: blog.title || 'Trip keepsake' });
      } else {
        check(); await Share.share({ title: blog.title || 'Trip keepsake', message: keepsakeText(blog) });
      }
    } catch (error: any) {
      popup?.close();
      if (alive.current && identity.current === operation) Alert.alert('Trip keepsake', error.message || 'Unable to prepare keepsake');
    } finally {
      if (lock.current === operation) lock.current=null;
      if (alive.current && identity.current === operation) setBusy(false);
    }
  };

  return (
    <>
      <KeepsakeMapCaptureHost ref={host} enabled={nativeEnabled} scope={scope}/>
      <TouchableOpacity testID="blog-keepsake-export" accessibilityRole="button" disabled={busy} onPress={() => setChoosing(true)} style={themeStyle('components_BlogKeepsakeButton_1', {  }, _styleTheme)}>
        <Text style={themeStyle('components_BlogKeepsakeButton_2', { textColor: textColor }, _styleTheme)}>{busy ? 'Preparing keepsake…' : 'Print / share keepsake'}</Text>
      </TouchableOpacity>
      <Modal visible={choosing} transparent animationType="fade" onRequestClose={() => setChoosing(false)}>
        <View style={themeStyle('components_BlogKeepsakeButton_3', {  }, _styleTheme)}>
          <View testID="keepsake-theme-picker" style={themeStyle('components_BlogKeepsakeButton_4', {  }, _styleTheme)}>
            <ScrollView style={themeStyle('dialogScroll', {}, _styleTheme)} nestedScrollEnabled showsVerticalScrollIndicator>
            <Text style={themeStyle('components_BlogKeepsakeButton_5', {  }, _styleTheme)}>Choose a keepsake style</Text>
            <Text style={themeStyle('components_BlogKeepsakeButton_6', {  }, _styleTheme)}>Your trip's notes and photos, laid out for printing or saving as a PDF.</Text>
            {KEEPSAKE_THEMES.map((theme) => {
              const selected = theme.key === themeKey;
              return (
                <TouchableOpacity
                  key={theme.key}
                  testID={`keepsake-theme-${theme.key}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setThemeKey(theme.key)}
                  style={themeStyle('components_BlogKeepsakeButton_7', { selected: selected, theme: theme }, _styleTheme)}
                >
                  {/* Mini page preview: background, card and accent stripe. */}
                  <View style={themeStyle('components_BlogKeepsakeButton_8', { theme: theme }, _styleTheme)}>
                    <View style={themeStyle('components_BlogKeepsakeButton_9', { theme: theme }, _styleTheme)} />
                  </View>
                  <View style={themeStyle('components_BlogKeepsakeButton_10', {  }, _styleTheme)}>
                    <Text style={themeStyle('components_BlogKeepsakeButton_11', {  }, _styleTheme)}>{theme.name}</Text>
                    <Text style={themeStyle('components_BlogKeepsakeButton_12', {  }, _styleTheme)}>{theme.description}</Text>
                  </View>
                  {selected ? <IconText style={themeStyle('components_BlogKeepsakeButton_13', { theme: theme }, _styleTheme)}>✓</IconText> : null}
                </TouchableOpacity>
              );
            })}
            <View style={themeStyle('components_BlogKeepsakeButton_14', {  }, _styleTheme)}>
              <TouchableOpacity testID="keepsake-theme-cancel" onPress={() => setChoosing(false)} style={themeStyle('components_BlogKeepsakeButton_15', {  }, _styleTheme)}>
                <Text style={themeStyle('components_BlogKeepsakeButton_16', {  }, _styleTheme)}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="keepsake-create" onPress={createKeepsake} style={themeStyle('components_BlogKeepsakeButton_17', {  }, _styleTheme)}>
                <Text style={themeStyle('components_BlogKeepsakeButton_18', {  }, _styleTheme)}>{Platform.OS === 'web' ? 'Create & print' : 'Create PDF'}</Text>
              </TouchableOpacity>
            </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
};

export default BlogKeepsakeButton;
