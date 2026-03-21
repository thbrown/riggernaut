export interface Vec2 {
  x: number;
  y: number;
}

export interface ComponentInstance {
  id: string;
  type: string;
  health: number;
  maxHealth: number;
  position: Vec2;
  /** Local offset within the rigid body */
  localOffset: Vec2;
  colliderHandle: number | null;
}

export interface ShipBlueprint {
  components: Array<{
    id: string;
    type: string;
    gridX: number;
    gridY: number;
    rotation: number;
    hotkey?: string;
    hotkeys?: string[];
    hotkeyPriority?: number;
    hotkeyPriorities?: Record<string, number>;
    hingeStartAngle?: number;
  }>;
  /** Pre-computed adjacency for quick BFS */
  adjacency: Record<string, string[]>;
}
