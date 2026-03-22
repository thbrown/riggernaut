import { ComponentType, Side } from '../../types/components';
import { getComponentDef } from '../../game/components';
import { rotateSide } from '../../types/grid';

const TILE_PX = 50;

/** Get the hinge starting angle steps */
export function getHingeStartAngleSteps(type: ComponentType): number {
  const def = getComponentDef(type);
  if (def.config.kind === 'hinge') return def.config.startAngleSteps;
  return 0;
}

/** Get effective base attachable sides for a component, accounting for hinge start angle */
function getEffectiveBaseSides(type: ComponentType, hingeStartAngle?: number, enabledSides?: Side[]): Side[] {
  const def = getComponentDef(type);
  let sides: Side[];

  if (def.colliderShape === 'circle' && def.config.kind === 'hinge') {
    const step = hingeStartAngle ?? 0;
    const movableSide = rotateSide(Side.East, step);
    sides = [Side.West, movableSide];
  } else {
    sides = [...def.attachableSides];
  }

  if (enabledSides) {
    sides = sides.filter(s => enabledSides.includes(s));
  }

  return sides;
}

export function getComponentColor(type: ComponentType): string {
  return getComponentDef(type).color;
}

interface ComponentRendererProps {
  type: ComponentType;
  rotation?: number;
  size?: number;
  dimmed?: boolean;
  hingeStartAngle?: number;
  enabledSides?: Side[];
  showLabel?: boolean;
}

/** Side direction offsets for drawing edge indicators (in component-local space) */
function sideEdge(side: Side, size: number, pad: number): { x1: number; y1: number; x2: number; y2: number } {
  const tabLen = size * 0.3;
  const half = tabLen / 2;
  const cx = size / 2;
  const cy = size / 2;
  switch (side) {
    case Side.North: return { x1: cx - half, y1: pad, x2: cx + half, y2: pad };
    case Side.South: return { x1: cx - half, y1: size - pad, x2: cx + half, y2: size - pad };
    case Side.East:  return { x1: size - pad, y1: cy - half, x2: size - pad, y2: cy + half };
    case Side.West:  return { x1: pad, y1: cy - half, x2: pad, y2: cy + half };
  }
}

/** Render a component as an SVG element */
export function ComponentRenderer({
  type, rotation = 0, size = TILE_PX, dimmed = false,
  hingeStartAngle, enabledSides,
}: ComponentRendererProps) {
  const def = getComponentDef(type);
  const color = def.color;
  const pad = 2;
  const inner = size - pad * 2;
  const center = size / 2;

  const isCircle = def.colliderShape === 'circle';

  const effectiveSides = getEffectiveBaseSides(type, hingeStartAngle, enabledSides);
  const allBaseSides = isCircle
    ? [Side.West, rotateSide(Side.East, hingeStartAngle ?? 0)]
    : def.attachableSides;

  return (
    <svg width={size} height={size} style={{ opacity: dimmed ? 0.65 : 1 }}>
      <g transform={`rotate(${rotation * 90} ${center} ${center})`}>
        {isCircle ? (
          <>
            <circle
              cx={center} cy={center}
              r={inner / 2}
              fill={color}
              stroke="#ffffff"
              strokeWidth={2}
              opacity={0.85}
            />
            <rect
              x={pad} y={pad}
              width={inner} height={inner}
              rx={4} ry={4}
              fill="none"
              stroke="#ffffff"
              strokeWidth={1}
              opacity={0.2}
            />
          </>
        ) : (
          <rect
            x={pad} y={pad}
            width={inner} height={inner}
            rx={4} ry={4}
            fill={color}
            stroke="#ffffff"
            strokeWidth={2}
            opacity={0.85}
          />
        )}

        {/* Attachment edge indicators */}
        {allBaseSides.map(side => {
          const enabled = effectiveSides.includes(side);
          const e = sideEdge(side, size, pad);
          return (
            <line
              key={side}
              x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
              stroke={enabled ? '#00ffcc' : 'rgba(255,255,255,0.15)'}
              strokeWidth={enabled ? 3 : 1}
              strokeLinecap="round"
            />
          );
        })}

        {/* Type-specific decoration */}
        {def.renderBuildDecoration?.(size, pad, inner, hingeStartAngle)}
      </g>
    </svg>
  );
}
