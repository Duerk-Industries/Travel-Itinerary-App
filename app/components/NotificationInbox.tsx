import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Modal from './KeyboardAwareModal';
import type { Notification, NotificationPreferences } from '../../server/src/types';
import { getSocket } from '../utils/socket';
import { registerForPushNotificationsAsync } from '../utils/pushNotifications';

type InboxRow = Pick<Notification, 'id' | 'category' | 'title' | 'body' | 'createdAt' | 'readAt'>;
const LABELS: Record<string, string> = { import_result: 'Imported bookings', cancellation_deadline: 'Cancellation deadlines', ai_finished: 'Itinerary ready', trip_digest: 'Daily summary', activity_recap: 'Activity recap' };
export default function NotificationInbox({ backendUrl, token, onOpen, openNotificationId, onOpenHandled }: {
  backendUrl: string; token: string; openNotificationId?: string | null; onOpenHandled?: () => void; onOpen: (target: { tripId: string | null; page: 'ingest' | 'blog' | 'overview'; activityId?: string }) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [count, setCount] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences[]>([]);
  const [digestEditing, setDigestEditing] = useState(false);
  const [digestTime, setDigestTime] = useState('08:00');
  const [digestTimezone, setDigestTimezone] = useState('UTC');
  const [timingCategory, setTimingCategory] = useState<string | null>(null);
  const [timezone, setTimezone] = useState('UTC');
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('08:00');
  const [settings, setSettings] = useState(false);
  const epoch = useRef(0);
  const headers = { Authorization: `Bearer ${token}` };
  const busy = useRef(false);
  const load = useCallback(async (next?: string) => {
    const current = epoch.current;
    try {
      const response = await fetch(`${backendUrl}/api/notifications?limit=20${next ? `&cursor=${encodeURIComponent(next)}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.status === 404) { if (current === epoch.current) setEnabled(false); return; }
      if (!response.ok) throw new Error('Updates could not load. Please refresh.');
      const data = await response.json(); if (current !== epoch.current) return;
      if (!Array.isArray(data.notifications) || !Number.isFinite(data.unreadCount)) throw new Error('Updates could not load. Please refresh.');
      setEnabled(true); setError(null); setCount(data.unreadCount); setCursor(data.nextCursor);
      setRows(previous => next ? [...new Map([...previous, ...data.notifications].map(row => [row.id, row])).values()] : data.notifications);
    } catch (error) { if (current === epoch.current) setError((error as Error).message); }
  }, [backendUrl, token]);
  useEffect(() => {
    epoch.current += 1; setRows([]); setCount(0); setOpen(false); setPreferences([]); setEnabled(false); setSettings(false); setError(null);
    void load();
    const socket = getSocket(); const refresh = () => { void load(); };
    socket.on('connect', refresh); socket.on('notification:changed', refresh);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { epoch.current += 1; socket.off('connect', refresh); socket.off('notification:changed', refresh); subscription.remove(); };
  }, [load]);
  const read = async (ids: string[] | 'all') => {
    const response = await fetch(`${backendUrl}/api/notifications/read`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(ids === 'all' ? { all: true } : { ids }) });
    if (!response.ok) throw new Error('Updates could not be marked read.');
  };
  const visit = async (row: Pick<InboxRow, 'id'>) => {
    const current = epoch.current;
    try {
      const response = await fetch(`${backendUrl}/api/notifications/${encodeURIComponent(row.id)}/open`, { headers });
      const target = await response.json(); if (!response.ok) throw new Error(target.error || 'This update is no longer available.');
      if (current !== epoch.current) return;
      await read([row.id]); await load(); if (current !== epoch.current) return; setOpen(false); onOpen(target);
    } catch (error) { if (current === epoch.current) { setOpen(true); setError((error as Error).message); } }
  };
  useEffect(() => {
    if (openNotificationId) { void visit({ id: openNotificationId }).finally(() => onOpenHandled?.()); }
  }, [openNotificationId, token, backendUrl]);
  const showSettings = async () => {
    const current = epoch.current;
    try {
      const response = await fetch(`${backendUrl}/api/notifications/preferences`, { headers });
      if (!response.ok) throw new Error('Notification settings could not load.');
      const data = await response.json(); if (current !== epoch.current) return;
      setPreferences(data.preferences); setSettings(true);
    } catch (error) { setError((error as Error).message); }
  };
  const toggle = async (preference: NotificationPreferences, channel: 'inApp' | 'push' | 'email') => {
    if (busy.current) return; busy.current = true;
    const current = epoch.current;
    try {
      if (channel === 'push' && !preference.push && Platform.OS !== 'web' && !(await registerForPushNotificationsAsync(token))) throw new Error('Mobile alerts are unavailable or permission was declined. Your inbox still works.');
      const update = { category: preference.category, inApp: preference.inApp, push: preference.push, email: preference.email, quietTiming: preference.quietTiming, [channel]: !preference[channel] };
      const response = await fetch(`${backendUrl}/api/notifications/preferences`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences: [update] }) });
      if (!response.ok) throw new Error('Settings could not be saved. Please try again.');
      if (current !== epoch.current) return;
      setPreferences(previous => previous.map(row => row.category === preference.category ? { ...row, ...update } : row));
    } catch (error) { setError((error as Error).message); }
    finally { busy.current = false; }
  };
  const saveTiming = async (preference: NotificationPreferences, clear = false) => {
    if (busy.current) return;
    busy.current = true;
    const current = epoch.current;
    try {
      const quietTiming = clear ? null : { timezone, quietStart, quietEnd };
      const update = { category: preference.category, inApp: preference.inApp, push: preference.push, email: preference.email, quietTiming };
      const response = await fetch(`${backendUrl}/api/notifications/preferences`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences: [update] }) });
      if (!response.ok) throw new Error('Use a timezone such as America/New_York and 24-hour times such as 22:00.');
      if (current !== epoch.current) return;
      setPreferences(previous => previous.map(row => row.category === preference.category ? { ...row, quietTiming } : row));
      setTimingCategory(null); setError(null);
    } catch (error) { if (current === epoch.current) setError((error as Error).message); }
    finally { busy.current = false; }
  };
  const saveDigest = async (preference: NotificationPreferences, clear = false) => {
    if (busy.current) return; busy.current = true;
    const current = epoch.current;
    try {
      const digestTiming = clear ? null : { timezone: digestTimezone, time: digestTime };
      const response = await fetch(`${backendUrl}/api/notifications/preferences`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences: [{ category: preference.category, inApp: preference.inApp, push: preference.push, email: preference.email, digestTiming }] }) });
      if (!response.ok) throw new Error('Use a timezone such as America/New_York and a 24-hour time such as 08:00.');
      if (current !== epoch.current) return;
      setPreferences(previous => previous.map(row => row.category === preference.category ? { ...row, digestTiming } : row));
      setDigestEditing(false); setError(null);
    } catch (error) { if (current === epoch.current) setError((error as Error).message); }
    finally { busy.current = false; }
  };
  if (!enabled) return null;
  const buttonStyle = { minHeight: 44, padding: 10, justifyContent: 'center' as const };
  return <>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Notifications, ${count} unread`} onPress={() => { setOpen(true); void load(); }} style={buttonStyle}><Text>🔔{count ? ` ${count}` : ''}</Text></TouchableOpacity>
    <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 16 }}>
        <View accessibilityViewIsModal style={{ backgroundColor: '#fff', borderRadius: 12, padding: 16, maxHeight: '90%', width: '100%', maxWidth: 600, alignSelf: 'center' }}>
          <Text accessibilityRole="header" style={{ fontSize: 22 }}>Notifications</Text>
          <TouchableOpacity style={buttonStyle} accessibilityRole="button" onPress={() => setOpen(false)}><Text>Close notifications</Text></TouchableOpacity>
          {error && <Text accessibilityRole="alert">{error}</Text>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <TouchableOpacity style={buttonStyle} accessibilityRole="button" onPress={() => void load()}><Text>Refresh</Text></TouchableOpacity>
            <TouchableOpacity style={buttonStyle} accessibilityRole="button" onPress={() => void read('all').then(() => load()).catch(error => setError(error.message))}><Text>Mark all read</Text></TouchableOpacity>
            <TouchableOpacity style={buttonStyle} accessibilityRole="button" onPress={() => void showSettings()}><Text>Alert settings</Text></TouchableOpacity>
          </View>
          <ScrollView>
            {settings ? <>
              <Text>Important updates and Daily summary have independent inbox, mobile alert, and email choices. Turning mobile alerts off never enables email.</Text>
              {preferences.map(preference => <View key={preference.category} style={{ paddingVertical: 8 }}>
                <Text style={{ fontWeight: '700' }}>{LABELS[preference.category] || preference.category.replace(/_/g, ' ')}</Text>
                {preference.category === 'trip_digest' && <>
                  <TouchableOpacity style={buttonStyle} accessibilityRole="button" onPress={() => {
                    setDigestTime(preference.digestTiming?.time || '08:00'); setDigestTimezone(preference.digestTiming?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'); setDigestEditing(true);
                  }}><Text>{preference.digestTiming ? 'Edit daily summary time' : 'Set daily summary time'}</Text></TouchableOpacity>
                  {digestEditing && <View>
                    <Text>Summaries cover a UTC calendar day and arrive at your next chosen local time. Clock-change gaps use the next valid time. Mobile alerts and email also respect quiet hours.</Text>
                    <TextInput accessibilityLabel="Daily summary timezone" value={digestTimezone} onChangeText={setDigestTimezone} style={{ minHeight: 44 }} />
                    <TextInput accessibilityLabel="Daily summary time, 24 hour time" value={digestTime} onChangeText={setDigestTime} style={{ minHeight: 44 }} />
                    <TouchableOpacity style={buttonStyle} accessibilityRole="button" onPress={() => void saveDigest(preference)}><Text>Save summary time</Text></TouchableOpacity>
                    <TouchableOpacity style={buttonStyle} accessibilityRole="button" onPress={() => void saveDigest(preference, true)}><Text>Use midnight UTC</Text></TouchableOpacity>
                  </View>}
                </>}
                <TouchableOpacity style={buttonStyle} accessibilityRole="button" onPress={() => {
                  setTimingCategory(preference.category); setTimezone(preference.quietTiming?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
                  setQuietStart(preference.quietTiming?.quietStart || '22:00'); setQuietEnd(preference.quietTiming?.quietEnd || '08:00');
                }}><Text>{preference.quietTiming ? 'Edit quiet hours' : 'Set quiet hours'}</Text></TouchableOpacity>
                {timingCategory === preference.category && <View>
                  <Text>Mobile alerts and email wait until quiet hours end. Updates still appear in your inbox.</Text>
                  <TextInput accessibilityLabel="Quiet hours timezone" value={timezone} onChangeText={setTimezone} style={{ minHeight: 44 }} />
                  <TextInput accessibilityLabel="Quiet hours start, 24 hour time" value={quietStart} onChangeText={setQuietStart} style={{ minHeight: 44 }} />
                  <TextInput accessibilityLabel="Quiet hours end, 24 hour time" value={quietEnd} onChangeText={setQuietEnd} style={{ minHeight: 44 }} />
                  <TouchableOpacity style={buttonStyle} accessibilityRole="button" onPress={() => void saveTiming(preference)}><Text>Save quiet hours</Text></TouchableOpacity>
                  <TouchableOpacity style={buttonStyle} accessibilityRole="button" onPress={() => void saveTiming(preference, true)}><Text>Turn quiet hours off</Text></TouchableOpacity>
                </View>}
                {(['inApp', 'push', 'email'] as const).map(channel => <TouchableOpacity key={channel} style={buttonStyle} accessibilityRole="checkbox" accessibilityState={{ checked: preference[channel] }} accessibilityLabel={`${LABELS[preference.category] || preference.category} ${channel}`}
                  onPress={() => void toggle(preference, channel)}><Text>{preference[channel] ? '☑' : '☐'} {channel === 'inApp' ? 'Inbox' : channel === 'push' ? 'Mobile alerts' : 'Email'}</Text></TouchableOpacity>)}
              </View>)}
              <TouchableOpacity style={buttonStyle} onPress={() => setSettings(false)}><Text>Back to updates</Text></TouchableOpacity>
            </> : <>
              {!rows.length && <Text>You’re all caught up.</Text>}
              {rows.map(row => <TouchableOpacity key={row.id} style={{ ...buttonStyle, borderBottomWidth: 1, borderBottomColor: '#ddd' }} accessibilityRole="button" onPress={() => void visit(row)}>
                <Text style={{ fontWeight: row.readAt ? '400' : '700' }}>{row.readAt ? '' : 'Unread · '}{row.title}</Text><Text>{row.body}</Text><Text>{new Date(row.createdAt).toLocaleString()}</Text>
              </TouchableOpacity>)}
              {cursor && <TouchableOpacity style={buttonStyle} accessibilityRole="button" onPress={() => void load(cursor)}><Text>Older updates</Text></TouchableOpacity>}
            </>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}
