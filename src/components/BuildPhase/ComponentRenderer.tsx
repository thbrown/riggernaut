import { ComponentType, Side } from '../../types/components';
import { getComponentDef } from '../../game/component-registry';
import { rotateSide } from '../../types/grid';

const TILE_PX = 50;

/** Get the hinge starting angle in 90° increments.
 *  90° hinge: 2 options (East, South)
 *  180° hinge: 3 options (East, South, North) */
export function getHingeStartAngleSteps(type: ComponentType): number {
  return type === ComponentType.Hinge90 ? 2 : 3;
}

/** Get the hinge starting angle in radians */
export function getHingeStartAngleRad(type: ComponentType, step: number): number {
  const maxSteps = getHingeStartAngleSteps(type);
  const s = step % maxSteps;
  if (type === ComponentType.Hinge90) {
    return [0, Math.PI / 2][s];
  }
  return [0, Math.PI / 2, -Math.PI / 2][s];
}

/** Get effective base attachable sides for a component, accounting for hinge start angle */
function getEffectiveBaseSides(type: ComponentType, hingeStartAngle?: number, enabledSides?: Side[]): Side[] {
  const isHinge = type === ComponentType.Hinge90 || type === ComponentType.Hinge180;
  let sides: Side[];

  if (isHinge) {
    const step = hingeStartAngle ?? 0;
    const movableSide = rotateSide(Side.East, step);
    sides = [Side.West, movableSide];
  } else {
    const def = getComponentDef(type);
    sides = [...def.attachableSides];
  }

  if (enabledSides) {
    sides = sides.filter(s => enabledSides.includes(s));
  }

  return sides;
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

/** Color palette for component types */
const COMPONENT_COLORS: Record<ComponentType, string> = {
  [ComponentType.CommandModule]: '#4488ff',
  [ComponentType.EngineSmall]: '#ffcc00',
  [ComponentType.EngineMedium]: '#ffcc00',
  [ComponentType.EngineLarge]: '#ffcc00',
  [ComponentType.Dummy]: '#888888',
  [ComponentType.Armor]: '#66aacc',
  [ComponentType.Ram]: '#cc4444',
  [ComponentType.BlasterSmall]: '#ff6633',
  [ComponentType.BlasterMedium]: '#ff6633',
  [ComponentType.BlasterLarge]: '#ff6633',
  [ComponentType.Decoupler]: '#33cc99',
  [ComponentType.Explosive]: '#ff3366',
  [ComponentType.Radio]: '#aa66ff',
  [ComponentType.Hinge90]: '#ccaa44',
  [ComponentType.Hinge180]: '#ccaa44',
};

export function getComponentColor(type: ComponentType): string {
  return COMPONENT_COLORS[type] ?? '#888888';
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
  const color = getComponentColor(type);
  const pad = 2;
  const inner = size - pad * 2;
  const center = size / 2;

  const isHinge = type === ComponentType.Hinge90 || type === ComponentType.Hinge180;

  // Compute effective attachable sides in component-local space (before rotation)
  const effectiveSides = getEffectiveBaseSides(type, hingeStartAngle, enabledSides);
  // All possible base sides (before enabledSides filtering) for showing disabled indicators
  const allBaseSides = isHinge
    ? [Side.West, rotateSide(Side.East, hingeStartAngle ?? 0)]
    : getComponentDef(type).attachableSides;

  return (
    <svg width={size} height={size} style={{ opacity: dimmed ? 0.65 : 1 }}>
      <g transform={`rotate(${rotation * 90} ${center} ${center})`}>
        {isHinge ? (
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
        {renderDecoration(type, size, pad, inner, hingeStartAngle)}
      </g>
    </svg>
  );
}

function renderDecoration(type: ComponentType, size: number, pad: number, inner: number, hingeStartAngle?: number) {
  const cx = size / 2;
  const cy = size / 2;

  switch (type) {
    case ComponentType.CommandModule:
      return (
        <polygon
          points={`${cx},${pad + 6} ${pad + inner - 6},${cy} ${cx},${pad + inner - 6} ${pad + 6},${cy}`}
          fill="none" stroke="#fff" strokeWidth={1.5}
        />
      );

    case ComponentType.EngineSmall:
    case ComponentType.EngineMedium:
    case ComponentType.EngineLarge: {
      const nw = type === ComponentType.EngineSmall ? 10 : type === ComponentType.EngineMedium ? 16 : 24;
      return (
        <rect
          x={cx - nw / 2} y={pad + inner - 8}
          width={nw} height={8}
          fill="#ff8800" rx={2}
        />
      );
    }

    case ComponentType.Ram:
      return (
        <polygon
          points={`${cx},${pad} ${pad + 8},${pad + 14} ${pad + inner - 8},${pad + 14}`}
          fill="#ff6666" stroke="#fff" strokeWidth={1}
        />
      );

    case ComponentType.BlasterSmall:
    case ComponentType.BlasterMedium:
    case ComponentType.BlasterLarge: {
      const bw = type === ComponentType.BlasterSmall ? 4 : type === ComponentType.BlasterMedium ? 6 : 10;
      return (
        <rect
          x={cx - bw / 2} y={pad}
          width={bw} height={14}
          fill="#fff" rx={1}
        />
      );
    }

    case ComponentType.Explosive:
      return <circle cx={cx} cy={cy} r={8} fill="none" stroke="#fff" strokeWidth={1.5} />;

    case ComponentType.Radio:
      return (
        <>
          <line x1={cx} y1={pad + 4} x2={cx - 8} y2={pad - 2} stroke="#fff" strokeWidth={1.5} />
          <line x1={cx} y1={pad + 4} x2={cx + 8} y2={pad - 2} stroke="#fff" strokeWidth={1.5} />
          <line x1={cx} y1={pad + 4} x2={cx} y2={cy} stroke="#fff" strokeWidth={1.5} />
        </>
      );

    case ComponentType.Decoupler:
      return (
        <>
          <circle cx={cx} cy={pad + 6} r={3} fill="#fff" />
          <circle cx={cx} cy={pad + inner - 6} r={3} fill="#fff" />
          <circle cx={pad + 6} cy={cy} r={3} fill="#fff" />
          <circle cx={pad + inner - 6} cy={cy} r={3} fill="#fff" />
        </>
      );

    case ComponentType.Hinge90:
    case ComponentType.Hinge180: {
      const r = inner * 0.3;
      const arcR = inner * 0.2;
      const halfRange = type === ComponentType.Hinge90 ? Math.PI / 4 : Math.PI / 2;
      const startAngle = hingeStartAngle !== undefined
        ? getHingeStartAngleRad(type, hingeStartAngle) : 0;

      // Current movable-side position
      const curX = cx + Math.cos(startAngle) * r;
      const curY = cy + Math.sin(startAngle) * r;
      // Sweep limits (relative to start angle)
      const limMin = startAngle - halfRange;
      const limMax = startAngle + halfRange;
      const limMinX = cx + Math.cos(limMin) * r;
      const limMinY = cy + Math.sin(limMin) * r;
      const limMaxX = cx + Math.cos(limMax) * r;
      const limMaxY = cy + Math.sin(limMax) * r;
      // Fixed side line (West)
      const xW = cx + Math.cos(Math.PI) * r;
      const yW = cy + Math.sin(Math.PI) * r;
      // Arc sweep
      const arcStartX = cx + Math.cos(limMin) * arcR;
      const arcStartY = cy + Math.sin(limMin) * arcR;
      const arcEndX = cx + Math.cos(limMax) * arcR;
      const arcEndY = cy + Math.sin(limMax) * arcR;
      const largeArc = halfRange > Math.PI / 2 ? 1 : 0;
      return (
        <>
          <circle cx={cx} cy={cy} r={2} fill="#fff" />
          <line x1={cx} y1={cy} x2={xW} y2={yW} stroke="#fff" strokeWidth={1.2} />
          <line x1={cx} y1={cy} x2={limMinX} y2={limMinY} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
          <line x1={cx} y1={cy} x2={limMaxX} y2={limMaxY} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
          <line x1={cx} y1={cy} x2={curX} y2={curY} stroke="#fff" strokeWidth={1.5} />
          <path
            d={`M ${arcStartX} ${arcStartY} A ${arcR} ${arcR} 0 ${largeArc} 1 ${arcEndX} ${arcEndY}`}
            fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={1}
          />
        </>
      );
    }

    default:
      return null;
  }
}
