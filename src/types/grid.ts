import { ComponentType, Side } from './components';

export interface GridPosition {
  x: number;
  y: number;
}

export interface PlacedComponent {
  id: string;
  type: ComponentType;
  position: GridPosition;
  /** Rotation in 90-degree increments (0, 1, 2, 3) = (0°, 90°, 180°, 270°) clockwise */
  rotation: number;
  hotkey?: string;
  /** Additional hotkeys for multi-key components (hinges: [left, right], decouplers: per-side) */
  hotkeys?: string[];
  /** Execution priority when sharing a hotkey (lower = earlier). Default 0. */
  hotkeyPriority?: number;
  /** Per-key priorities for multi-key components (key → priority). Overrides hotkeyPriority. */
  hotkeyPriorities?: Record<string, number>;
  /** Hinge starting angle index (0, 1, 2). Bends movable side to a grid-aligned direction. */
  hingeStartAngle?: number;
  /** Which of the component's attachable sides are enabled (component-local space).
   *  If undefined, all base sides are enabled. */
  enabledSides?: Side[];
}

export interface BuildGrid {
  width: number;
  height: number;
  components: PlacedComponent[];
}

export function oppositeSide(side: Side): Side {
  switch (side) {
    case Side.North: return Side.South;
    case Side.South: return Side.North;
    case Side.East: return Side.West;
    case Side.West: return Side.East;
  }
}

export function rotateSide(side: Side, rotation: number): Side {
  const order: Side[] = [Side.North, Side.East, Side.South, Side.West];
  const idx = order.indexOf(side);
  return order[(idx + rotation) % 4];
}
