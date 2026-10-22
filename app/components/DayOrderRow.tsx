import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import { ThemedText as Text } from './ThemedText';
import type { DayOrderRowProps } from './dayOrderDrag';

/** Native dragging uses RN's responder API; the handle keeps row links and controls usable. */
export default function DayOrderRow(props: DayOrderRowProps) {
  const latest = useRef(props); latest.current = props;
  const [offset, setOffset] = useState(0);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.disabled,
    onMoveShouldSetPanResponder: () => !latest.current.disabled,
    onPanResponderGrant: () => latest.current.onStart(latest.current.id),
    onPanResponderMove: (_event, gesture) => setOffset(gesture.dy),
    onPanResponderRelease: (_event, gesture) => { setOffset(0); latest.current.onEnd(gesture.dy); },
    onPanResponderTerminate: () => { setOffset(0); latest.current.onEnd(); },
    onPanResponderTerminationRequest: () => false,
  }), []);
  return <View testID={`day-order-row-${props.id}`} style={offset ? { transform: [{ translateY: offset }], zIndex: 1, opacity: 0.85 } : undefined}
    onLayout={event => props.onLayout(props.id, event.nativeEvent.layout.y, event.nativeEvent.layout.height)}>
    {!props.disabled && <View {...responder.panHandlers} testID={`day-order-drag-${props.id}`}
      accessible accessibilityLabel={`Drag ${props.name} to reorder. Move up and down buttons are also available.`}
      style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }}>
      <Text>⠿ Drag to reorder</Text>
    </View>}
    {props.children}
  </View>;
}
