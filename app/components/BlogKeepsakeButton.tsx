import KeepsakeMapCaptureHost from './KeepsakeMapCaptureHost';
import type { KeepsakeMapCaptureHandle } from './KeepsakeMapCaptureHost.types';
import { keepsakeMapFallback } from '../utils/keepsakeMapData';
import { captureKeepsakeMap, type KeepsakeMapCapture } from '../utils/keepsakeMapCapture';
import type { BlogMapDay } from '../../server/src/services/blogMapService';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Share, Text, TouchableOpacity, View } from 'react-native';
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

const BlogKeepsakeButton: React.FC<Props> = ({ backendUrl, headers, tripId, nativeEnabled = false, textColor = '#111827' }) => {
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
        popup.document.write('<p style="font:16px system-ui;padding:24px;color:#6b7280">Preparing your keepsake…</p>');
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
      <TouchableOpacity testID="blog-keepsake-export" accessibilityRole="button" disabled={busy} onPress={() => setChoosing(true)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
        <Text style={{ color: textColor, fontWeight: '700' }}>{busy ? 'Preparing keepsake…' : 'Print / share keepsake'}</Text>
      </TouchableOpacity>
      <Modal visible={choosing} transparent animationType="fade" onRequestClose={() => setChoosing(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center', padding: 20 }}>
          <View testID="keepsake-theme-picker" style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, maxWidth: 440, width: '100%', alignSelf: 'center' }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 4 }}>Choose a keepsake style</Text>
            <Text style={{ fontSize: 14, color: '#6b7280', marginBottom: 14 }}>Your trip's notes and photos, laid out for printing or saving as a PDF.</Text>
            {KEEPSAKE_THEMES.map((theme) => {
              const selected = theme.key === themeKey;
              return (
                <TouchableOpacity
                  key={theme.key}
                  testID={`keepsake-theme-${theme.key}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setThemeKey(theme.key)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12, borderWidth: 2, borderColor: selected ? theme.accent : '#e5e7eb', marginBottom: 8 }}
                >
                  {/* Mini page preview: background, card and accent stripe. */}
                  <View style={{ width: 48, height: 40, borderRadius: 8, backgroundColor: theme.page, borderWidth: 1, borderColor: '#d1d5db', padding: 6, justifyContent: 'center' }}>
                    <View style={{ height: 22, borderRadius: 4, backgroundColor: theme.card, borderTopWidth: 3, borderTopColor: theme.accent }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', color: '#111827' }}>{theme.name}</Text>
                    <Text style={{ fontSize: 12, color: '#6b7280' }}>{theme.description}</Text>
                  </View>
                  {selected ? <Text style={{ color: theme.accent === '#F5B041' ? '#b7791f' : theme.accent, fontWeight: '800' }}>✓</Text> : null}
                </TouchableOpacity>
              );
            })}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <TouchableOpacity testID="keepsake-theme-cancel" onPress={() => setChoosing(false)} style={{ paddingVertical: 10, paddingHorizontal: 14 }}>
                <Text style={{ color: '#374151', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="keepsake-create" onPress={createKeepsake} style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#F59E0B' }}>
                <Text style={{ color: '#111827', fontWeight: '700' }}>{Platform.OS === 'web' ? 'Create & print' : 'Create PDF'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

export default BlogKeepsakeButton;
