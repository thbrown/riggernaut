import React from 'react';
import { ComponentDef, ComponentType, Side, ALL_SIDES } from '../../types/components';

const threeSides = (excluded: Side): Side[] => ALL_SIDES.filter(s => s !== excluded);

const BLASTER_STATS = {
  small:  { boltSpeed: 20, boltRange: 120, damage: 10, fireRatePerSec: 5,   boltColor: '#ff3333', boltWidth: 0.15, boltLength: 0.4,  kickback: 8,  barrelWidth: 2 },
  medium: { boltSpeed: 14, boltRange: 150, damage: 25, fireRatePerSec: 2.5, boltColor: '#ffcc00', boltWidth: 0.2,  boltLength: 0.55, kickback: 20, barrelWidth: 3 },
  large:  { boltSpeed: 8,  boltRange: 200, damage: 50, fireRatePerSec: 1,   boltColor: '#9933ff', boltWidth: 0.3,  boltLength: 0.75, kickback: 50, barrelWidth: 5 },
} as const;

function blasterDef(size: 'small' | 'medium' | 'large', type: ComponentType): ComponentDef {
  const bs = BLASTER_STATS[size];
  return {
    type,
    displayName: `Blaster (${size[0].toUpperCase()})`,
    color: '#ff6633',
    hardness: 0.5,
    mass: 100,
    maxHealth: 50,
    attachableSides: threeSides(Side.North),
    colliderShape: 'square',
    hasPower: true,
    activationMode: 'hold',
    hotkeyLayout: 'single',
    functionalSide: Side.North,
    config: {
      kind: 'blaster',
      boltSpeed: bs.boltSpeed,
      boltRange: bs.boltRange,
      damage: bs.damage,
      fireRatePerSec: bs.fireRatePerSec,
      kickback: bs.kickback,
      boltLength: bs.boltLength,
      boltWidth: bs.boltWidth,
      boltColor: bs.boltColor,
    },

    drawDecoration(ctx, halfSize) {
      const s = halfSize * 0.6;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(-bs.barrelWidth, -halfSize + 1, bs.barrelWidth * 2, s * 1.2);
    },

    drawEffect(ctx, _hs, comp, sim) {
      // Blaster recoil animation
      if (comp.lastFireTick !== undefined) {
        const ticksSinceFire = sim.tickCount - comp.lastFireTick;
        if (ticksSinceFire < 8) {
          const recoilMag = size === 'large' ? 4 : size === 'medium' ? 2.5 : 1.5;
          const t = ticksSinceFire / 8;
          const recoil = recoilMag * Math.exp(-t * 4) * Math.cos(t * Math.PI * 2);
          ctx.translate(0, recoil);
        }
      }
    },

    renderBuildDecoration(bSize, pad) {
      const cx = bSize / 2;
      const bw = size === 'small' ? 4 : size === 'medium' ? 6 : 10;
      return React.createElement('rect', {
        x: cx - bw / 2, y: pad,
        width: bw, height: 14,
        fill: '#fff', rx: 1,
      });
    },
  };
}

export const BlasterSmallDef = blasterDef('small', ComponentType.BlasterSmall);
export const BlasterMediumDef = blasterDef('medium', ComponentType.BlasterMedium);
export const BlasterLargeDef = blasterDef('large', ComponentType.BlasterLarge);
