import { ComponentType } from '../../types/components';

const TILE_PX = 50;

interface ComponentRendererProps {
  type: ComponentType;
  rotation?: number;
  size?: number;
  dimmed?: boolean;
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

/** Render a component as an SVG element */
export function ComponentRenderer({ type, rotation = 0, size = TILE_PX, dimmed = false }: ComponentRendererProps) {
  const color = getComponentColor(type);
  const pad = 2;
  const inner = size - pad * 2;
  const center = size / 2;

  return (
    <svg width={size} height={size} style={{ opacity: dimmed ? 0.65 : 1 }}>
      <g transform={`rotate(${rotation * 90} ${center} ${center})`}>
        {/* Base rectangle */}
        <rect
          x={pad} y={pad}
          width={inner} height={inner}
          rx={4} ry={4}
          fill={color}
          stroke="#ffffff"
          strokeWidth={2}
          opacity={0.85}
        />
        {/* Type-specific decoration */}
        {renderDecoration(type, size, pad, inner)}
      </g>
    </svg>
  );
}

function renderDecoration(type: ComponentType, size: number, pad: number, inner: number) {
  const cx = size / 2;
  const cy = size / 2;

  switch (type) {
    case ComponentType.CommandModule:
      // Diamond shape
      return (
        <polygon
          points={`${cx},${pad + 6} ${pad + inner - 6},${cy} ${cx},${pad + inner - 6} ${pad + 6},${cy}`}
          fill="none" stroke="#fff" strokeWidth={1.5}
        />
      );

    case ComponentType.EngineSmall:
    case ComponentType.EngineMedium:
    case ComponentType.EngineLarge: {
      // Exhaust nozzle at bottom
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
      // Pointed triangle at top
      return (
        <polygon
          points={`${cx},${pad} ${pad + 8},${pad + 14} ${pad + inner - 8},${pad + 14}`}
          fill="#ff6666" stroke="#fff" strokeWidth={1}
        />
      );

    case ComponentType.BlasterSmall:
    case ComponentType.BlasterMedium:
    case ComponentType.BlasterLarge: {
      // Barrel at top
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
      // Warning circle
      return <circle cx={cx} cy={cy} r={8} fill="none" stroke="#fff" strokeWidth={1.5} />;

    case ComponentType.Radio:
      // Antenna lines
      return (
        <>
          <line x1={cx} y1={pad + 4} x2={cx - 8} y2={pad - 2} stroke="#fff" strokeWidth={1.5} />
          <line x1={cx} y1={pad + 4} x2={cx + 8} y2={pad - 2} stroke="#fff" strokeWidth={1.5} />
          <line x1={cx} y1={pad + 4} x2={cx} y2={cy} stroke="#fff" strokeWidth={1.5} />
        </>
      );

    case ComponentType.Decoupler:
      // Four dots for the four sides
      return (
        <>
          <circle cx={cx} cy={pad + 6} r={3} fill="#fff" />
          <circle cx={cx} cy={pad + inner - 6} r={3} fill="#fff" />
          <circle cx={pad + 6} cy={cy} r={3} fill="#fff" />
          <circle cx={pad + inner - 6} cy={cy} r={3} fill="#fff" />
        </>
      );

    case ComponentType.Hinge90:
    case ComponentType.Hinge180:
      // Arc symbol
      return (
        <path
          d={type === ComponentType.Hinge90
            ? `M ${pad + 6} ${cy} A ${inner / 3} ${inner / 3} 0 0 1 ${pad + inner - 6} ${cy}`
            : `M ${pad + 6} ${cy + 6} A ${inner / 2.5} ${inner / 2.5} 0 0 1 ${pad + inner - 6} ${cy + 6}`
          }
          fill="none" stroke="#fff" strokeWidth={1.5}
        />
      );

    default:
      return null;
  }
}
