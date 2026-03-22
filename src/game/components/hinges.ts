import React from 'react';
import { ComponentDef, ComponentType, Side } from '../../types/components';
import { rotateSide } from '../../types/grid';
import { hotkeyDisplayChar } from '../../utils/hotkey-display';

/** Get the hinge starting angle in radians */
export function getHingeStartAngleRad(type: ComponentType, step: number): number {
  const maxSteps = type === ComponentType.Hinge90 ? 2 : 3;
  const s = step % maxSteps;
  if (type === ComponentType.Hinge90) {
    return [0, Math.PI / 2][s];
  }
  return [0, Math.PI / 2, -Math.PI / 2][s];
}

function hingeDef(type: ComponentType, maxAngle: number, steps: number): ComponentDef {
  return {
    type,
    displayName: type === ComponentType.Hinge90 ? 'Hinge (90°)' : 'Hinge (180°)',
    color: '#ccaa44',
    hardness: 0.5,
    mass: 100,
    maxHealth: 50,
    attachableSides: [Side.East, Side.West],
    colliderShape: 'circle',
    hasPower: true,
    activationMode: 'hold',
    hotkeyLayout: 'dual',
    config: { kind: 'hinge', maxAngle, startAngleSteps: steps },

    getAttachableSides(comp) {
      const step = comp.hingeStartAngle ?? 0;
      let baseSides = [Side.West, rotateSide(Side.East, step)];
      if (comp.enabledSides) {
        baseSides = baseSides.filter(s => comp.enabledSides!.includes(s));
      }
      return baseSides.map(s => rotateSide(s, comp.rotation));
    },

    drawDecoration(ctx, hs) {
      const s = hs * 0.6;
      const r = s * 0.55;
      const arcR = s * 0.35;
      const halfRange = maxAngle / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.2;
      // Center dot
      ctx.beginPath();
      ctx.arc(0, 0, 2, 0, Math.PI * 2);
      ctx.fill();
      // Fixed side line (West)
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(Math.PI) * r, Math.sin(Math.PI) * r);
      ctx.stroke();
      // Sweep limit lines
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(-halfRange) * r, Math.sin(-halfRange) * r);
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(halfRange) * r, Math.sin(halfRange) * r);
      ctx.stroke();
      // Arc sweep
      ctx.beginPath();
      ctx.arc(0, 0, arcR, -halfRange, halfRange);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.stroke();
    },

    drawHotkeyLabel(ctx, hs, comp) {
      if (!comp.hotkey && !comp.hotkeys?.[0]) return;
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const edgeOffset = hs * 0.7;
      const hingeKeys = [
        { x: -edgeOffset, y: 0, key: comp.hotkey },
        { x: edgeOffset, y: 0, key: comp.hotkeys?.[0] },
      ];
      for (const hk of hingeKeys) {
        if (!hk.key) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(hk.x - 6, hk.y - 5, 12, 10);
        ctx.fillStyle = '#fff';
        ctx.fillText(hotkeyDisplayChar(hk.key), hk.x, hk.y);
      }
    },

    renderBuildDecoration(size, _pad, inner, hingeStartAngle) {
      const cx = size / 2;
      const cy = size / 2;
      const r = inner * 0.3;
      const arcR = inner * 0.2;
      const halfRange = maxAngle / 2;
      const startAngle = hingeStartAngle !== undefined
        ? getHingeStartAngleRad(type, hingeStartAngle) : 0;

      const curX = cx + Math.cos(startAngle) * r;
      const curY = cy + Math.sin(startAngle) * r;
      const limMin = startAngle - halfRange;
      const limMax = startAngle + halfRange;
      const limMinX = cx + Math.cos(limMin) * r;
      const limMinY = cy + Math.sin(limMin) * r;
      const limMaxX = cx + Math.cos(limMax) * r;
      const limMaxY = cy + Math.sin(limMax) * r;
      const xW = cx + Math.cos(Math.PI) * r;
      const yW = cy + Math.sin(Math.PI) * r;
      const arcStartX = cx + Math.cos(limMin) * arcR;
      const arcStartY = cy + Math.sin(limMin) * arcR;
      const arcEndX = cx + Math.cos(limMax) * arcR;
      const arcEndY = cy + Math.sin(limMax) * arcR;
      const largeArc = halfRange > Math.PI / 2 ? 1 : 0;

      return React.createElement(React.Fragment, null,
        React.createElement('circle', { cx, cy, r: 2, fill: '#fff' }),
        React.createElement('line', { x1: cx, y1: cy, x2: xW, y2: yW, stroke: '#fff', strokeWidth: 1.2 }),
        React.createElement('line', { x1: cx, y1: cy, x2: limMinX, y2: limMinY, stroke: 'rgba(255,255,255,0.3)', strokeWidth: 1 }),
        React.createElement('line', { x1: cx, y1: cy, x2: limMaxX, y2: limMaxY, stroke: 'rgba(255,255,255,0.3)', strokeWidth: 1 }),
        React.createElement('line', { x1: cx, y1: cy, x2: curX, y2: curY, stroke: '#fff', strokeWidth: 1.5 }),
        React.createElement('path', {
          d: `M ${arcStartX} ${arcStartY} A ${arcR} ${arcR} 0 ${largeArc} 1 ${arcEndX} ${arcEndY}`,
          fill: 'none', stroke: 'rgba(255,255,255,0.4)', strokeWidth: 1,
        }),
      );
    },
  };
}

export const Hinge90Def = hingeDef(ComponentType.Hinge90, Math.PI / 2, 2);
export const Hinge180Def = hingeDef(ComponentType.Hinge180, Math.PI, 3);
