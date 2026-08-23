import React, { useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

export type BlogMediaMetadataPatch = { caption: string; altText: string; isDecorative: boolean };

type Props = {
  item: any;
  canSuggest?: boolean;
  busy?: boolean;
  onSave: (patch: BlogMediaMetadataPatch) => Promise<void>;
  onSuggest?: () => Promise<{ caption?: string; altText?: string }>;
  textColor?: string;
  mutedColor?: string;
  borderColor?: string;
  backgroundColor?: string;
  styles?: any;
};

const BlogMediaMetadataEditor: React.FC<Props> = ({
  item, canSuggest = false, busy = false, onSave, onSuggest, textColor = '#111827',
  mutedColor = '#6b7280', borderColor = '#d1d5db', backgroundColor = '#fff', styles,
}) => {
  const [caption, setCaption] = useState('');
  const [altText, setAltText] = useState('');
  const [isDecorative, setIsDecorative] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setCaption(String(item?.caption ?? ''));
    setAltText(String(item?.altText ?? ''));
    setIsDecorative(Boolean(item?.isDecorative));
    setNotice('');
  }, [item?.assetId, item?.caption, item?.altText, item?.isDecorative]);

  const suggest = async () => {
    if (!onSuggest || busy) return;
    try {
      const result = await onSuggest();
      if (result.caption) setCaption(result.caption);
      if (result.altText) { setAltText(result.altText); setIsDecorative(false); }
      setNotice('AI suggestion added as a draft. Review it before saving.');
    } catch (error: any) {
      setNotice(error?.message || 'Unable to suggest text');
    }
  };

  const save = async () => {
    try {
      await onSave({ caption: caption.trim().slice(0, 500), altText: isDecorative ? '' : altText.trim().slice(0, 1000), isDecorative });
      setNotice('Saved');
    } catch (error: any) {
      setNotice(error?.message || 'Unable to save photo details');
    }
  };

  return (
    <View testID="blog-media-metadata-editor" style={{ marginTop: 10, borderWidth: 1, borderColor, borderRadius: 8, padding: 10, backgroundColor }}>
      <Text style={{ color: textColor, fontWeight: '700' }}>Photo details</Text>
      <TextInput
        testID="blog-media-caption-input"
        value={caption}
        onChangeText={(value) => setCaption(value.slice(0, 500))}
        placeholder="Add a caption"
        placeholderTextColor={mutedColor}
        multiline
        style={{ color: textColor, borderWidth: 1, borderColor, borderRadius: 6, padding: 8, marginTop: 8 }}
      />
      <TextInput
        testID="blog-media-alt-text-input"
        value={altText}
        editable={!isDecorative}
        onChangeText={(value) => setAltText(value.slice(0, 1000))}
        placeholder={isDecorative ? 'Not required for a decorative image' : 'Describe the image for screen-reader users'}
        placeholderTextColor={mutedColor}
        multiline
        style={{ color: textColor, opacity: isDecorative ? 0.55 : 1, borderWidth: 1, borderColor, borderRadius: 6, padding: 8, marginTop: 8 }}
      />
      <TouchableOpacity testID="blog-media-decorative-toggle" accessibilityRole="checkbox" accessibilityState={{ checked: isDecorative }} onPress={() => { setIsDecorative((value) => !value); setNotice(''); }} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
        <Text style={{ color: textColor, marginRight: 6 }}>{isDecorative ? '☑' : '☐'}</Text>
        <Text style={{ color: mutedColor }}>Decorative image (no alt text needed)</Text>
      </TouchableOpacity>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        <TouchableOpacity testID="blog-media-save-metadata" disabled={busy || (!isDecorative && !altText.trim())} onPress={save} style={styles?.button}>
          <Text style={styles?.buttonText}>{busy ? 'Saving…' : 'Save details'}</Text>
        </TouchableOpacity>
        {canSuggest ? (
          <TouchableOpacity testID="blog-media-suggest-metadata" disabled={busy} onPress={suggest} style={[styles?.button, { backgroundColor: '#7c3aed' }]}>
            <Text style={styles?.buttonText}>{busy ? 'Working…' : 'Suggest with AI'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {notice ? <Text accessibilityLiveRegion="polite" style={{ color: mutedColor, fontSize: 12, marginTop: 6 }}>{notice}</Text> : null}
    </View>
  );
};

export default BlogMediaMetadataEditor;
