// @ts-nocheck
// Rich-text (WYSIWYG) editor for Trip Blog entries, backed by @10play/tentap-editor
// (TipTap/ProseMirror under a WebView on native, an iframe shim on web via
// @10play/react-native-web-webview — see metro.shared.cjs for the web resolver
// aliases this depends on). One component, one HTML output format, on every
// platform the app runs on — matching the "co-located per tab" convention isn't
// possible for a genuinely shared editor widget, so this lives in app/components/
// like the other cross-tab UI (LodgingForm, ConfirmDialog, etc.).
//
// Content is stored/exchanged as an HTML string, matching blog_item.body in the
// existing schema — no changes needed server-side.
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useEditorBridge, RichText, Toolbar, DEFAULT_TOOLBAR_ITEMS, TenTapStartKit, CoreBridge } from '@10play/tentap-editor';

type Props = {
  value: string;
  onChangeHTML?: (html: string) => void;
  editable?: boolean;
  minHeight?: number;
  borderColor?: string;
  backgroundColor?: string;
  textColor?: string;
  testID?: string;
};

const BlogRichTextEditor = ({
  value,
  onChangeHTML,
  editable = true,
  minHeight = 160,
  borderColor = '#ccd4df',
  backgroundColor = '#ffffff',
  textColor = '#111827',
  testID,
}: Props) => {
  // theme.webview.backgroundColor (below) only paints the WebView/iframe's own background — it
  // doesn't touch the actual document text color, which TipTap otherwise renders in its default
  // black regardless of the app's light/dark theme (illegible against a dark background). Rather
  // than fix that up after the fact with injectCSS (which leaves a brief flash of black text
  // before the post-mount effect lands), configure the color into CoreBridge's CSS at bridge
  // creation time so the WebView never paints the wrong color to begin with. This — like
  // `theme`/`initialContent` below — is only read once at mount; a color that needs to update on
  // an already-mounted editor (e.g. a live light/dark toggle) requires remounting via `key`,
  // same as the existing content-refresh caveat below.
  const bridgeExtensions = useMemo(
    () => [
      ...TenTapStartKit,
      CoreBridge.configureCSS(
        `body, .ProseMirror, .ProseMirror p, .ProseMirror li, .ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6, .ProseMirror blockquote { color: ${textColor}; } .ProseMirror { caret-color: ${textColor}; }`
      ),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // initialContent is only read once by the bridge on mount; changing `value`
  // afterward (e.g. after a save/reload) intentionally does not re-sync the
  // live document — that would clobber in-progress edits. Callers that need
  // to show fresh content (switching which item is being edited, or a
  // read-only viewer whose underlying data changed) should remount via `key`.
  const editor = useEditorBridge({
    editable,
    autofocus: false,
    avoidIosKeyboard: true,
    dynamicHeight: !editable,
    initialContent: value || '',
    bridgeExtensions,
    theme: {
      webview: { backgroundColor },
      toolbar: { toolbarBody: { backgroundColor, borderTopColor: borderColor, borderBottomColor: borderColor } },
    },
    onChange: async () => {
      if (!onChangeHTML) return;
      const html = await editor.getHTML();
      onChangeHTML(html);
    },
  });

  return (
    <View
      testID={testID}
      style={{
        borderWidth: editable ? 1 : 0,
        borderColor,
        borderRadius: 8,
        backgroundColor,
        minHeight: editable ? minHeight : undefined,
        overflow: 'hidden',
      }}
    >
      <RichText editor={editor} />
      {editable ? <Toolbar editor={editor} items={DEFAULT_TOOLBAR_ITEMS} /> : null}
    </View>
  );
};

export default BlogRichTextEditor;
