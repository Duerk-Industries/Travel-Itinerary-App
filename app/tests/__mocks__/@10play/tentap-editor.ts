import React from 'react';

// @10play/tentap-editor renders TipTap inside a react-native-webview (or its web shim),
// neither of which run in this project's jsdom/node test environment. Tests that touch
// TripBlogTab only need BlogRichTextEditor to render as an inert stand-in and for its
// content to be readable/settable via testID + props — not actual ProseMirror behavior.
export const useEditorBridge = jest.fn((options: Record<string, unknown>) => ({
  getHTML: jest.fn(async () => String((options as any)?.initialContent ?? '')),
  injectCSS: jest.fn(),
}));

export const RichText = (props: Record<string, unknown>) => React.createElement('rich-text', props);
export const Toolbar = (props: Record<string, unknown>) => React.createElement('rich-text-toolbar', props);
export const DEFAULT_TOOLBAR_ITEMS: unknown[] = [];
