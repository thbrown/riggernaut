import { ComponentType } from '../../types/components';
import { getComponentDef } from '../../game/component-registry';

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
  };
}
