/** @jest-environment jsdom */
/// <reference types="jest" />
import React from 'react';
import { render } from '@testing-library/react-native';
import BlogRichTextView from '../components/BlogRichTextView';
import BlogRichTextEditor from '../components/BlogRichTextEditor';

jest.mock('@10play/tentap-editor', () => ({
  useEditorBridge: jest.fn(() => { throw new Error('the WebView editor must not be created for read-only notes'); }),
  RichText: () => null, Toolbar: () => null, DEFAULT_TOOLBAR_ITEMS: [], TenTapStartKit: [], CoreBridge: { configureCSS: () => ({}) },
}));

describe('read-only blog notes', () => {
  it('renders the note text with no trailing blank block', () => {
    const view = render(<BlogRichTextView testID="note" html="<p>Flew in from Italy.</p><p></p><p></p>" textColor="#fff" />);
    expect(view.getByText('Flew in from Italy.')).toBeTruthy();
    expect(view.getByTestId('note').props.children).toHaveLength(1);
  });

  it('renders nothing for an empty note', () => {
    expect(render(<BlogRichTextView testID="note" html="<p></p>" />).queryByTestId('note')).toBeNull();
  });

  it('uses the lightweight view (not the editor) when editable is false', () => {
    const view = render(<BlogRichTextEditor testID="view" value="<p>Hello <strong>there</strong></p>" editable={false} textColor="#fff" />);
    expect(view.getByTestId('view')).toBeTruthy();
    expect(view.getByText('there')).toBeTruthy();
  });
});
