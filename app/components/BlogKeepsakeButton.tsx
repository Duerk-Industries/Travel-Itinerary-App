import React, { useState } from 'react';
import { Alert, Platform, Share, Text, TouchableOpacity } from 'react-native';

const plain = (value: unknown): string => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const escapeHtml = (value: unknown): string => plain(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));

type Props = { backendUrl: string; headers: Record<string, string>; tripId: string; textColor?: string };

const BlogKeepsakeButton: React.FC<Props> = ({ backendUrl, headers, tripId, textColor = '#111827' }) => {
  const [busy, setBusy] = useState(false);
  const exportKeepsake = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`${backendUrl}/api/trips/${tripId}/blog?limit=100`, { headers });
      const blog = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(blog.error || 'Unable to prepare keepsake');
      const lines = [blog.title || 'Trip keepsake', plain(blog.subtitle), plain(blog.introduction), ...(blog.days || []).flatMap((day: any) => [day.headline || day.localDate, plain(day.summary), ...(day.items || []).filter((item: any) => item.kindKey === 'core.text').map((item: any) => plain(item.body))])].filter(Boolean);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const popup = window.open('', '_blank');
        if (!popup) throw new Error('Allow pop-ups to open the print keepsake');
        popup.opener = null;
        const sections = (blog.days || []).map((day: any) => {
          const media = (day.items || []).flatMap((item: any) => item.kindKey === 'core.gallery' ? (item.assets || []) : item.kindKey?.startsWith('media.') ? [item] : []);
          const figures = media.filter((item: any) => item.mediaKind === 'photo' && (item.primaryUrl || item.thumbnailUrl)).map((item: any) => `<figure><img src="${escapeHtml(item.primaryUrl || item.thumbnailUrl)}" alt="${escapeHtml(item.altText || item.caption || 'Trip photo')}">${item.caption ? `<figcaption>${escapeHtml(item.caption)}</figcaption>` : ''}</figure>`).join('');
          return `<section><h2>${escapeHtml(day.headline || day.localDate)}</h2><p class="date">${escapeHtml(day.localDate)}</p>${day.summary ? `<p>${escapeHtml(day.summary)}</p>` : ''}${(day.items || []).filter((item: any) => item.kindKey === 'core.text').map((item: any) => `<p>${escapeHtml(item.body)}</p>`).join('')}${figures}</section>`;
        }).join('');
        popup.document.write(`<!doctype html><html><head><title>${escapeHtml(blog.title || 'Trip keepsake')}</title><style>body{font:16px/1.55 Georgia,serif;max-width:760px;margin:40px auto;padding:0 24px;color:#1f2937}h1,h2{font-family:system-ui,sans-serif}section{break-inside:avoid;margin:32px 0}.date,figcaption{color:#6b7280;font-size:13px}figure{margin:20px 0;break-inside:avoid}img{display:block;width:100%;max-height:620px;object-fit:contain;border-radius:8px}@media print{body{margin:0}}</style></head><body><h1>${escapeHtml(blog.title || 'Trip keepsake')}</h1>${blog.subtitle ? `<p>${escapeHtml(blog.subtitle)}</p>` : ''}${sections}</body></html>`);
        popup.document.close();
        popup.focus();
        window.setTimeout(() => popup.print(), 500);
      } else {
        await Share.share({ title: blog.title || 'Trip keepsake', message: lines.join('\n\n') });
      }
    } catch (error: any) { Alert.alert('Trip keepsake', error.message || 'Unable to prepare keepsake'); }
    finally { setBusy(false); }
  };
  return <TouchableOpacity testID="blog-keepsake-export" accessibilityRole="button" disabled={busy} onPress={exportKeepsake} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}><Text style={{ color: textColor, fontWeight: '700' }}>{busy ? 'Preparing keepsake…' : 'Print / share keepsake'}</Text></TouchableOpacity>;
};

export default BlogKeepsakeButton;
