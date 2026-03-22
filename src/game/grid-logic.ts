import { PlacedComponent, GridPosition, oppositeSide, rotateSide } from '../types/grid';
import { Side } from '../types/components';
import { getComponentDef } from './components';
import { ComponentType } from '../types/components';

function posKey(pos: GridPosition): string {
  return `${pos.x},${pos.y}`;
}

function getNeighborPos(pos: GridPosition, side: Side): GridPosition {
  switch (side) {
    case Side.North: return { x: pos.x, y: pos.y - 1 };
    case Side.South: return { x: pos.x, y: pos.y + 1 };
    case Side.East:  return { x: pos.x + 1, y: pos.y };
    case Side.West:  return { x: pos.x - 1, y: pos.y };
  }
}

/** Get the actual attachable sides for a component, accounting for rotation,
 *  hinge start angle, and enabled sides filtering. */
export function getRotatedAttachableSides(comp: PlacedComponent): Side[] {
  const def = getComponentDef(comp.type as ComponentType);
  let baseSides: Side[];

  if (def.colliderShape === 'circle' && def.config.kind === 'hinge') {
    const step = comp.hingeStartAngle ?? 0;
    const movableSide = rotateSide(Side.East, step);
    baseSides = [Side.West, movableSide];
  } else {
    baseSides = def.attachableSides;
  }

  if (comp.enabledSides) {
    baseSides = baseSides.filter(s => comp.enabledSides!.includes(s));
  }

  return baseSides.map(s => rotateSide(s, comp.rotation));
}

/** Check if two adjacent components can attach on the shared boundary */
function canAttach(a: PlacedComponent, sideFromA: Side, b: PlacedComponent): boolean {
  const aSides = getRotatedAttachableSides(a);
  const bSides = getRotatedAttachableSides(b);
  return aSides.includes(sideFromA) && bSides.includes(oppositeSide(sideFromA));
}

export interface AttachmentResult {
  /** Component IDs connected to any Command Module */
  attached: Set<string>;
  /** Component IDs NOT connected to any Command Module */
  unattached: Set<string>;
}

/** BFS from all Command Modules, following valid attachments */
export function computeAttachment(components: PlacedComponent[]): AttachmentResult {
  const byPos = new Map<string, PlacedComponent>();
  for (const c of components) {
    byPos.set(posKey(c.position), c);
  }

  const attached = new Set<string>();
  const queue: PlacedComponent[] = [];

  // Seed BFS with all anchors (CommandModule) and drone controllers (Radio)
  for (const c of components) {
    const def = getComponentDef(c.type as ComponentType);
    if (def.isConnectivityAnchor || def.enablesDroneControl) {
      attached.add(c.id);
      queue.push(c);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const sides: Side[] = [Side.North, Side.South, Side.East, Side.West];

    for (const side of sides) {
      const neighborPos = getNeighborPos(current.position, side);
      const neighbor = byPos.get(posKey(neighborPos));
      if (neighbor && !attached.has(neighbor.id) && canAttach(current, side, neighbor)) {
        attached.add(neighbor.id);
        queue.push(neighbor);
      }
    }
  }

  const unattached = new Set<string>();
  for (const c of components) {
    if (!attached.has(c.id)) {
      unattached.add(c.id);
    }
  }

  return { attached, unattached };
}

/** Check if a position is occupied */
export function isOccupied(components: PlacedComponent[], pos: GridPosition): boolean {
  return components.some(c => c.position.x === pos.x && c.position.y === pos.y);
}

/** Compute adjacency map (component id -> neighbor ids) for blueprint serialization */
export function computeAdjacency(components: PlacedComponent[]): Record<string, string[]> {
  const byPos = new Map<string, PlacedComponent>();
  for (const c of components) {
    byPos.set(posKey(c.position), c);
  }

  const adjacency: Record<string, string[]> = {};
  for (const c of components) {
    adjacency[c.id] = [];
    const sides: Side[] = [Side.North, Side.South, Side.East, Side.West];
    for (const side of sides) {
      const neighborPos = getNeighborPos(c.position, side);
      const neighbor = byPos.get(posKey(neighborPos));
      if (neighbor && canAttach(c, side, neighbor)) {
        adjacency[c.id].push(neighbor.id);
      }
    }
  }

  return adjacency;
}
