import React from 'react';
import { ComponentDef, ComponentType, Side, ALL_SIDES } from '../../types/components';
import { rotateSide } from '../../types/grid';
import { FIXED_TIMESTEP, PIXELS_PER_METER } from '../../config/constants';

const threeSides = (excluded: Side): Side[] => ALL_SIDES.filter(s => s !== excluded);

const ENGINE_STATS = {
  small:  { thrust: 300,  exhaust: { semiMajor: 0.9, semiMinor: 0.4 }, dps: 10, nozzleScale: 0.5 },
  medium: { thrust: 600,  exhaust: { semiMajor: 1.8, semiMinor: 0.8 }, dps: 20, nozzleScale: 0.7 },
  large:  { thrust: 1200, exhaust: { semiMajor: 3.6, semiMinor: 1.6 }, dps: 40, nozzleScale: 1.0 },
} as const;

function engineDef(size: 'small' | 'medium' | 'large', type: ComponentType): ComponentDef {
  const s = ENGINE_STATS[size];
  return {
    type,
    displayName: `Engine (${size[0].toUpperCase()})`,
    color: '#ffcc00',
    hardness: 0.5,
    mass: 100,
    maxHealth: 50,
    attachableSides: threeSides(Side.South),
    colliderShape: 'square',
    hasPower: true,
    activationMode: 'hold',
    hotkeyLayout: 'single',
    functionalSide: Side.South,
    config: {
      kind: 'engine',
      thrust: s.thrust,
      exhaustShape: { semiMajor: s.exhaust.semiMajor, semiMinor: s.exhaust.semiMinor },
      exhaustDps: s.dps,
      nozzleScale: s.nozzleScale,
    },

    onTickActive(sim, comp, _ship) {
      const body = sim.world.getRigidBody(comp.bodyHandle);
      if (!body) return;

      const def = this as ComponentDef;
      const functionalSide = def.functionalSide ?? Side.South;
      const thrustSide = rotateSide(functionalSide, comp.rotation);

      let dx = 0, dy = 0;
      switch (thrustSide) {
        case Side.North: dx = 0; dy = 1; break;
        case Side.South: dx = 0; dy = -1; break;
        case Side.East: dx = -1; dy = 0; break;
        case Side.West: dx = 1; dy = 0; break;
      }

      const angle = body.rotation();
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const fx = (dx * cos - dy * sin) * s.thrust;
      const fy = (dx * sin + dy * cos) * s.thrust;

      const collider = sim.world.getCollider(comp.colliderHandle);
      if (!collider) return;

      const worldPos = collider.translation();
      body.applyImpulseAtPoint(
        { x: fx * FIXED_TIMESTEP, y: fy * FIXED_TIMESTEP },
        { x: worldPos.x, y: worldPos.y },
        true,
      );
    },

    drawDecoration(ctx, hs) {
      const nw = hs * 0.6 * s.nozzleScale;
      ctx.fillStyle = 'rgba(255,136,0,0.7)';
      ctx.fillRect(-nw, hs * 0.3, nw * 2, hs * 0.5);
    },

    drawEffect(ctx, hs, comp, sim) {
      if (!comp.isActive) return;

      const shape = s.exhaust;
      const majPx = shape.semiMajor * PIXELS_PER_METER;
      const minPx = shape.semiMinor * PIXELS_PER_METER;
      const particleCount = size === 'small' ? 10 : size === 'medium' ? 18 : 40;

      const prevComposite = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'lighter';

      const oy = hs;

      for (let i = 0; i < particleCount; i++) {
        const along = Math.pow(Math.random(), 1.5) * majPx;
        const t = along / majPx;
        const taper = 0.15 + 0.85 * t;
        const maxPerp = minPx * Math.sqrt(1 - t * t) * taper;
        const perp = (Math.random() - 0.5) * 2 * maxPerp;

        const na = along / majPx;
        const nb = perp / minPx;
        const d = Math.sqrt(na * na + nb * nb);
        if (d > 0.85) continue;

        const px = perp;
        const py = oy + along;
        const radius = 3 + d * 4;

        const r = 255;
        const g = Math.floor(255 - d * 225 + Math.random() * 20);
        const b = Math.floor(220 * (1 - d * 1.4) + Math.random() * 10);
        const a = 0.8 - d * 0.6 + Math.random() * 0.1;

        ctx.fillStyle = `rgba(${r}, ${Math.max(0, g)}, ${Math.max(0, b)}, ${Math.max(0.05, a)})`;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalCompositeOperation = prevComposite;

      // Engine glow
      const flicker = Math.sin(sim.tickCount * 0.3 + comp.colliderHandle) * 0.05;
      ctx.fillStyle = `rgba(255, 200, 50, ${0.15 + flicker})`;
      ctx.fillRect(-hs + 1, -hs + 1, hs * 2 - 2, hs * 2 - 2);
    },

    renderBuildDecoration(bSize, pad, inner) {
      const cx = bSize / 2;
      const nw = size === 'small' ? 10 : size === 'medium' ? 16 : 24;
      return React.createElement('rect', {
        x: cx - nw / 2, y: pad + inner - 8,
        width: nw, height: 8,
        fill: '#ff8800', rx: 2,
      });
    },
  };
}

export const EngineSmallDef = engineDef('small', ComponentType.EngineSmall);
export const EngineMediumDef = engineDef('medium', ComponentType.EngineMedium);
export const EngineLargeDef = engineDef('large', ComponentType.EngineLarge);
