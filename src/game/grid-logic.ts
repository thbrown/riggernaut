import { PlacedComponent, GridPosition, oppositeSide, rotateSide } from '../types/grid';
import { Side } from '../types/components';
import { getComponentDef } from './component-registry';
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

/** Get the effective base attachable sides for a hinge, accounting for starting angle.
 *  The fixed side (West) stays, the movable side (East) rotates by startAngle steps. */
function getHingeBaseSides(_type: ComponentType, hingeStartAngle?: number): Side[] {
  const step = hingeStartAngle ?? 0;
  // Movable side (East) rotates by step * 90° increments
  const movableSide = rotateSide(Side.East, step);
  return [Side.West, movableSide];
}

/** Get the actual attachable sides for a component, accounting for rotation,
 *  hinge start angle, and enabled sides filtering. */
export function getRotatedAttachableSides(comp: PlacedComponent): Side[] {
  const isHinge = comp.type === ComponentType.Hinge90 || comp.type === ComponentType.Hinge180;
  let baseSides: Side[];

  if (isHinge) {
    baseSides = getHingeBaseSides(comp.type as ComponentType, comp.hingeStartAngle);
  } else {
    const def = getComponentDef(comp.type as ComponentType);
    baseSides = def.attachableSides;
  }

  // Filter by enabled sides if specified
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

  // Seed BFS with all Command Modules and Radios
  for (const c of components) {
    if (c.type === ComponentType.CommandModule || c.type === ComponentType.Radio) {
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
