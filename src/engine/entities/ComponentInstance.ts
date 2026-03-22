import { ComponentType, Side } from '../../types/components';
import { getComponentDef } from '../../game/components';

/** Who controls this component's activation state */
export type Owner = 'player' | 'ai' | null;

export interface ComponentInstance {
  id: string;
  type: ComponentType;
  gridX: number;
  gridY: number;
  rotation: number;
  hotkey?: string;
  hotkeys?: string[];
  hotkeyPriority?: number;
  health: number;
  maxHealth: number;
  colliderHandle: number;
  /** Which rigid body owns this component */
  bodyHandle: number;
  /** Who can change this component's activation (null = space junk, state frozen) */
  owner: Owner;
  /** Whether this component is currently activated (engine thrusting, blaster firing, etc.) */
  isActive: boolean;
  /** Tick when this component last took damage (for flash rendering) */
  lastDamageTick?: number;
  /** Countdown ticks until manual detonation (undefined = not counting down) */
  detonationCountdown?: number;
  /** Tick when this blaster last fired (for recoil animation) */
  lastFireTick?: number;
  /** Per-key priorities for multi-key components */
  hotkeyPriorities?: Record<string, number>;
  /** Which of the component's attachable sides are enabled (component-local space).
   *  If undefined, all base sides are enabled. */
  enabledSides?: Side[];
  /** Hinge starting angle index (0, 1, 2). Determines movable-side direction. */
  hingeStartAngle?: number;
  /** Body handle of the last entity that dealt damage to this component */
  lastAttackerBodyHandle?: number;
}

export function createComponentInstance(
  id: string,
  type: ComponentType,
  gridX: number,
  gridY: number,
  rotation: number,
  colliderHandle: number,
  bodyHandle: number,
  owner: Owner,
  hotkey?: string,
  hotkeys?: string[],
  hotkeyPriority?: number,
  enabledSides?: Side[],
  hingeStartAngle?: number,
): ComponentInstance {
  const def = getComponentDef(type);
  return {
    id,
    type,
    gridX,
    gridY,
    rotation,
    hotkey,
    hotkeys,
    hotkeyPriority,
    health: def.maxHealth,
    maxHealth: def.maxHealth,
    colliderHandle,
    bodyHandle,
    owner,
    isActive: false,
    enabledSides,
    hingeStartAngle,
  };
}
