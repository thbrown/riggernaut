import React from 'react';
import { ComponentDef, ComponentType, Side, ALL_SIDES } from '../../types/components';
import { DECOUPLER_ATTRACTION_RADIUS, PIXELS_PER_METER } from '../../config/constants';
import { hotkeyDisplayChar } from '../../utils/hotkey-display';

/** Convert a Side to a local-space unit direction */
function sideToLocalDir(side: Side): { dx: number; dy: number } {
  switch (side) {
    case Side.North: return { dx: 0, dy: -1 };
    case Side.South: return { dx: 0, dy: 1 };
    case Side.East: return { dx: 1, dy: 0 };
    case Side.West: return { dx: -1, dy: 0 };
  }
}

export const DecouplerDef: ComponentDef = {
  type: ComponentType.Decoupler,
  displayName: '(De)coupler',
  color: '#33cc99',
  hardness: 0.5,
  mass: 100,
  maxHealth: 50,
  attachableSides: [...ALL_SIDES],
  colliderShape: 'square',
  hasPower: true,
  activationMode: 'press',
  hotkeyLayout: 'quad',
  config: { kind: 'decoupler' },

  drawDecoration(_ctx, _hs) {
    // Side dot indicators are drawn in drawEffect since they need sim state
  },

  drawEffect(ctx, hs, comp, sim) {
    // Decoupler side indicators: filled = latched, hollow = unlatched, pulsing cyan = attractor
    const dcState = sim.decouplers.find(d => d.compId === comp.id);
    const dotR = 3;
    const dotOffset = hs * 0.6;
    const dotPositions: Array<{ x: number; y: number; baseSide: Side }> = [
      { x: 0, y: -dotOffset, baseSide: Side.North },
      { x: dotOffset, y: 0, baseSide: Side.East },
      { x: 0, y: dotOffset, baseSide: Side.South },
      { x: -dotOffset, y: 0, baseSide: Side.West },
    ];
    for (const dot of dotPositions) {
      const sideState = dcState?.sides.find(s => s.baseSide === dot.baseSide);
      const mode = sideState?.mode ?? 'latched';

      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dotR, 0, Math.PI * 2);
      if (mode === 'latched') {
        ctx.fillStyle = '#fff';
        ctx.fill();
      } else if (mode === 'attractor') {
        const pulse = 0.5 + 0.5 * Math.sin(sim.tickCount * 0.15);
        ctx.fillStyle = `rgba(0, 255, 220, ${0.5 + pulse * 0.5})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(0, 255, 220, ${pulse * 0.6})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dotR + 2 + pulse * 2, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // Attractor particle effect
    const attractorSides = dcState?.sides.filter(s => s.mode === 'attractor') ?? [];
    if (attractorSides.length > 0) {
      const attractRadPx = DECOUPLER_ATTRACTION_RADIUS * PIXELS_PER_METER;
      const prevComposite = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'lighter';

      for (const side of attractorSides) {
        const dir = sideToLocalDir(side.baseSide);
        for (let pi = 0; pi < 10; pi++) {
          const t = ((sim.tickCount * 0.03 + pi * 0.1) % 1);
          const dist = (1 - t) * attractRadPx;
          const spread = (Math.sin(pi * 7.3 + sim.tickCount * 0.02) * 0.4) * attractRadPx * 0.3;
          const px = dir.dx * dist - dir.dy * spread;
          const py = dir.dy * dist + dir.dx * spread;
          const r = (1.5 + (1 - t) * 2);
          const a = 0.3 + t * 0.5;
          ctx.fillStyle = `rgba(0, 255, 220, ${a})`;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.globalCompositeOperation = prevComposite;
    }
  },

  drawHotkeyLabel(ctx, hs, comp) {
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const edgeOffset = hs * 0.75;
    const edgePositions = [
      { x: 0, y: -edgeOffset },  // North
      { x: edgeOffset, y: 0 },   // East
      { x: 0, y: edgeOffset },   // South
      { x: -edgeOffset, y: 0 },  // West
    ];
    for (let ei = 0; ei < edgePositions.length; ei++) {
      const hk = ei === 0 ? comp.hotkey : comp.hotkeys?.[ei - 1];
      if (!hk) continue;
      const ep = edgePositions[ei];
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(ep.x - 6, ep.y - 5, 12, 10);
      ctx.fillStyle = '#fff';
      ctx.fillText(hotkeyDisplayChar(hk), ep.x, ep.y);
    }
  },

  renderBuildDecoration(size, pad, inner) {
    const cx = size / 2;
    const cy = size / 2;
    return React.createElement(React.Fragment, null,
      React.createElement('circle', { cx, cy: pad + 6, r: 3, fill: '#fff' }),
      React.createElement('circle', { cx, cy: pad + inner - 6, r: 3, fill: '#fff' }),
      React.createElement('circle', { cx: pad + 6, cy, r: 3, fill: '#fff' }),
      React.createElement('circle', { cx: pad + inner - 6, cy, r: 3, fill: '#fff' }),
    );
  },
};
