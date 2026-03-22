import React from 'react';
import { ComponentDef, ComponentType, Side, ALL_SIDES } from '../../types/components';

const threeSides = (excluded: Side): Side[] => ALL_SIDES.filter(s => s !== excluded);

export const DummyDef: ComponentDef = {
  type: ComponentType.Dummy,
  displayName: 'Dummy',
  color: '#888888',
  hardness: 1,
  mass: 100,
  maxHealth: 100,
  attachableSides: [...ALL_SIDES],
  colliderShape: 'square',
  hasPower: false,
  activationMode: 'none',
  hotkeyLayout: 'single',
  config: { kind: 'passive' },
};

export const ArmorDef: ComponentDef = {
  type: ComponentType.Armor,
  displayName: 'Armor',
  color: '#66aacc',
  hardness: 5,
  mass: 100,
  maxHealth: 200,
  attachableSides: [...ALL_SIDES],
  colliderShape: 'square',
  hasPower: false,
  activationMode: 'none',
  hotkeyLayout: 'single',
  config: { kind: 'passive' },
};

export const RamDef: ComponentDef = {
  type: ComponentType.Ram,
  displayName: 'Ram',
  color: '#cc4444',
  hardness: 10,
  mass: 100,
  maxHealth: 100,
  attachableSides: threeSides(Side.North),
  colliderShape: 'square',
  hasPower: false,
  activationMode: 'none',
  hotkeyLayout: 'single',
  functionalSide: Side.North,
  config: { kind: 'passive' },

  drawDecoration(ctx, hs) {
    const s = hs * 0.6;
    ctx.beginPath();
    ctx.moveTo(0, -s); ctx.lineTo(-s * 0.7, s * 0.3); ctx.lineTo(s * 0.7, s * 0.3);
    ctx.closePath(); ctx.fillStyle = 'rgba(255,100,100,0.7)'; ctx.fill();
  },

  renderBuildDecoration(size, pad, inner) {
    const cx = size / 2;
    return React.createElement('polygon', {
      points: `${cx},${pad} ${pad + 8},${pad + 14} ${pad + inner - 8},${pad + 14}`,
      fill: '#ff6666', stroke: '#fff', strokeWidth: 1,
    });
  },
};
