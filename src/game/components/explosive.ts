import React from 'react';
import { ComponentDef, ComponentType, ALL_SIDES } from '../../types/components';

export const ExplosiveDef: ComponentDef = {
  type: ComponentType.Explosive,
  displayName: 'Explosive',
  color: '#ff3366',
  hardness: 1,
  mass: 100,
  maxHealth: 25,
  attachableSides: [...ALL_SIDES],
  colliderShape: 'square',
  hasPower: true,
  activationMode: 'press',
  hotkeyLayout: 'single',
  chainReactsOnDeath: true,
  config: { kind: 'explosive', detonationFuse: 60 },

  onHotkeyPressed(_sim, comp, _ship, _key) {
    if (comp.health <= 0) return;
    if (comp.detonationCountdown === undefined) {
      comp.detonationCountdown = 60;
    }
  },

  drawDecoration(ctx, hs) {
    const s = hs * 0.6;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.55, 0, Math.PI * 2);
    ctx.stroke();
  },

  drawEffect(ctx, hs, comp, sim) {
    if (comp.detonationCountdown !== undefined && comp.detonationCountdown > 0) {
      const progress = 1 - comp.detonationCountdown / 60;
      const pulse = 0.3 + 0.7 * progress;
      const flicker = Math.sin(sim.tickCount * (0.3 + progress * 1.5)) * 0.15;
      ctx.fillStyle = `rgba(255, 150, 0, ${(pulse + flicker) * 0.6})`;
      ctx.fillRect(-hs + 1, -hs + 1, hs * 2 - 2, hs * 2 - 2);
    }
  },

  renderBuildDecoration(size) {
    const cx = size / 2;
    const cy = size / 2;
    return React.createElement('circle', {
      cx, cy, r: 8, fill: 'none', stroke: '#fff', strokeWidth: 1.5,
    });
  },
};
