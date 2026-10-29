/** @jest-environment node */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Modal, Platform, ScrollView, Text, View } from 'react-native';
import DialogShell from '../components/DialogShell';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const flatten = (style: any): Record<string, any> => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

test('dialogs use a viewport modal and stay top aligned inside a long table', () => {
  let tree: ReturnType<typeof renderer.create>;
  act(() => {
    tree = renderer.create(<View style={{ height: 50000 }}>
      <DialogShell visible title="Details" testID="dialog" onClose={() => {}}
        styles={{ modalOverlay: { justifyContent: 'center' }, confirmModal: { marginTop: 400 } }}>
        <Text>Content</Text>
      </DialogShell>
    </View>);
  });
  expect(tree!.root.findAllByType(Modal)).toHaveLength(1);
  const overlay = tree!.root.findAllByType(View).find((node: any) => node.props.testID === 'dialog')!;
  expect(flatten(overlay.props.style)).toMatchObject({ top: 0, bottom: 0, justifyContent: 'flex-start', paddingTop: 24 });
  const card = overlay.findAllByType(View).find((node: any) => flatten(node.props.style)?.maxHeight === '100%')!;
  expect(flatten(card.props.style)).toMatchObject({ marginTop: 0, maxHeight: '100%' });
  act(() => tree!.unmount());
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
