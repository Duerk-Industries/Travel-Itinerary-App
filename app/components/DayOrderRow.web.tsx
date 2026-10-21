import React from 'react';
import type { DayOrderRowProps } from './dayOrderDrag';

/** HTML drag events stay in this web-only module; native bundles never import DOM code. */
export default function DayOrderRow(props: DayOrderRowProps) {
  return <div onDragOver={event => { if (!props.disabled) event.preventDefault(); }}
    onDrop={event => { event.preventDefault(); if (!props.disabled) props.onDrop(props.id); }}>
    {!props.disabled && <div draggable data-testid={`day-order-drag-${props.id}`}
      aria-label={`Drag ${props.name} to reorder. Move up and down buttons are also available.`}
      style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'grab', paddingInline: 12 }}
      onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', props.id); props.onStart(props.id); }}
      onDragEnd={() => props.onEnd()}>
      ⠿ Drag to reorder
    </div>}
    {props.children}
  </div>;
}
