import React from 'react';
import { ComponentDef, ComponentType, ALL_SIDES } from '../../types/components';

export const CommandModuleDef: ComponentDef = {
  type: ComponentType.CommandModule,
  displayName: 'Command Module',
  color: '#4488ff',
  hardness: 2,
  mass: 100,
  maxHealth: 100,
  attachableSides: [...ALL_SIDES],
  colliderShape: 'square',
  hasPower: false,
  activationMode: 'none',
  hotkeyLayout: 'single',
  isConnectivityAnchor: true,
  config: { kind: 'passive' },

  drawDecoration(ctx, hs) {
    const s = hs * 0.6;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0);
    ctx.closePath(); ctx.stroke();
  },

  renderBuildDecoration(size, pad, inner) {
    const cx = size / 2;
    const cy = size / 2;
    return React.createElement('polygon', {
      points: `${cx},${pad + 6} ${pad + inner - 6},${cy} ${cx},${pad + inner - 6} ${pad + 6},${cy}`,
      fill: 'none', stroke: '#fff', strokeWidth: 1.5,
    });
  },
};
