/** @jest-environment node */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Modal, Text, View } from 'react-native';
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
