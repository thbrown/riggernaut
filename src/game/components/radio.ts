import React from 'react';
import { ComponentDef, ComponentType, ALL_SIDES } from '../../types/components';

export const RadioDef: ComponentDef = {
  type: ComponentType.Radio,
  displayName: 'Radio',
  color: '#aa66ff',
  hardness: 1,
  mass: 100,
  maxHealth: 100,
  attachableSides: [...ALL_SIDES],
  colliderShape: 'square',
  hasPower: false,
  activationMode: 'none',
  hotkeyLayout: 'single',
  enablesDroneControl: true,
  config: { kind: 'passive' },

  drawDecoration(ctx, hs) {
    const s = hs * 0.6;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.2); ctx.lineTo(-s * 0.6, -s);
    ctx.moveTo(0, -s * 0.2); ctx.lineTo(s * 0.6, -s);
    ctx.moveTo(0, -s * 0.2); ctx.lineTo(0, s * 0.4);
    ctx.stroke();
  },

  renderBuildDecoration(size, pad) {
    const cx = size / 2;
    const cy = size / 2;
    return React.createElement(React.Fragment, null,
      React.createElement('line', { x1: cx, y1: pad + 4, x2: cx - 8, y2: pad - 2, stroke: '#fff', strokeWidth: 1.5 }),
      React.createElement('line', { x1: cx, y1: pad + 4, x2: cx + 8, y2: pad - 2, stroke: '#fff', strokeWidth: 1.5 }),
      React.createElement('line', { x1: cx, y1: pad + 4, x2: cx, y2: cy, stroke: '#fff', strokeWidth: 1.5 }),
    );
  },
};
