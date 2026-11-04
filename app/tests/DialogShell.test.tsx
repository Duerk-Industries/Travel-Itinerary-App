/** @jest-environment node */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Modal, Platform, ScrollView, Text, View } from 'react-native';
import DialogShell from '../components/DialogShell';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const flatten = (style: any): Record<string, any> => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

const renderInTallPage = (useNativeModal?: boolean) => {
  let tree: ReturnType<typeof renderer.create>;
  act(() => {
    tree = renderer.create(<View style={{ height: 50000 }}>
      <DialogShell visible title="Details" testID="dialog" onClose={() => {}} useNativeModal={useNativeModal}
        styles={{ modalOverlay: { justifyContent: 'center' }, confirmModal: { marginTop: 400 } }}>
        <Text>Content</Text>
      </DialogShell>
    </View>);
  });
  const overlay = tree!.root.findAllByType(View).find((node: any) => node.props.testID === 'dialog')!;
  return { tree: tree!, overlay };
};

test('dialogs open in a viewport modal, centered in it', () => {
  const { tree, overlay } = renderInTallPage();
  expect(tree.root.findAllByType(Modal)).toHaveLength(1);
  expect(flatten(overlay.props.style)).toMatchObject({ top: 0, bottom: 0, justifyContent: 'center' });
  const card = overlay.findAllByType(View).find((node: any) => flatten(node.props.style)?.maxHeight === '100%')!;
  expect(flatten(card.props.style)).toMatchObject({ marginTop: 0, maxHeight: '100%' });
  act(() => tree.unmount());
});

test('an inline dialog stays top aligned, so a long page cannot push it off screen', () => {
  const { tree, overlay } = renderInTallPage(false);
  expect(tree.root.findAllByType(Modal)).toHaveLength(0);
  expect(flatten(overlay.props.style)).toMatchObject({ top: 0, bottom: 0, justifyContent: 'flex-start', paddingTop: 24 });
  act(() => tree.unmount());
});

test('keeps a modal dialog clear of the iPhone status bar and home indicator', () => {
  const original = Platform.OS;
  Platform.OS = 'ios';
  try {
    const { tree, overlay } = renderInTallPage();
    expect(flatten(overlay.props.style)).toMatchObject({ paddingTop: 56, paddingBottom: 34 });
    act(() => tree.unmount());
  } finally { Platform.OS = original; }
});

const originalOS = Platform.OS;
afterEach(() => { Platform.OS = originalOS; });

test.each(['ios', 'android', 'web'] as const)('bounds tall dialog content and enables nested scrolling on %s', platform => {
  Platform.OS = platform;
  let tree: ReturnType<typeof renderer.create>;
  act(() => {
    tree = renderer.create(<DialogShell visible title="Long form" onClose={() => {}} styles={{}}>
      {Array.from({ length: 100 }, (_, index) => <Text key={index}>Field {index}</Text>)}
    </DialogShell>);
  });
  const scroll = tree!.root.findByType(ScrollView);
  expect(scroll.props.nestedScrollEnabled).toBe(true);
  expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  expect(flatten(scroll.props.style)).toMatchObject({ minHeight: 0, flexShrink: 1 });
  expect(tree!.root.findAllByType(View).some((node: { props: { style?: unknown } }) => {
    const style = flatten(node.props.style);
    return style.maxHeight === '100%' && style.minHeight === 0 && style.flexShrink === 1;
  })).toBe(true);
  act(() => tree!.unmount());
});

test('allows a dialog with its own scrolling body to retain one scroll owner', () => {
  let tree: ReturnType<typeof renderer.create>;
  act(() => {
    tree = renderer.create(<DialogShell visible title="Table" scrollable={false} onClose={() => {}} styles={{}}>
      <ScrollView testID="own-scroll"><Text>Content</Text></ScrollView>
    </DialogShell>);
  });
  expect(tree!.root.findAllByType(ScrollView)).toHaveLength(1);
  expect(tree!.root.findByType(ScrollView).props.testID).toBe('own-scroll');
  act(() => tree!.unmount());
});
