import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React from 'react';
import type { DayOrderRowProps } from './dayOrderDrag';

/** HTML drag events stay in this web-only module; native bundles never import DOM code. */
export default function DayOrderRow(props: DayOrderRowProps) {
  const _styleTheme = useStyleTheme();
  return <div onDragOver={event => { if (!props.disabled) event.preventDefault(); }}
    onDrop={event => { event.preventDefault(); if (!props.disabled) props.onDrop(props.id); }}>
    {!props.disabled && <div draggable data-testid={`day-order-drag-${props.id}`}
      aria-label={`Drag ${props.name} to reorder. Move up and down buttons are also available.`}
      style={themeStyle('components_DayOrderRow_web_1', {  }, _styleTheme)}
      onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', props.id); props.onStart(props.id); }}
      onDragEnd={() => props.onEnd()}>
      <span aria-hidden="true">⠿</span>
    </div>}
    {props.children}
  </div>;
}
