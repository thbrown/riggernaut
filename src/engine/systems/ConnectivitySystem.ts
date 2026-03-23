import { ShipState } from '../BattleSimulation';
import { Side } from '../../types/components';
import { getComponentDef } from '../../game/components';
import { rotateSide, oppositeSide } from '../../types/grid';
import { ComponentInstance } from '../entities/ComponentInstance';

/** Get the rotated attachable sides for a runtime ComponentInstance */
function getAttachableSides(comp: ComponentInstance): Side[] {
  const def = getComponentDef(comp.type);
  if (def.getAttachableSides) {
    return def.getAttachableSides(comp);
  }
  let baseSides = def.attachableSides;
  if (comp.enabledSides) {
    baseSides = baseSides.filter(s => comp.enabledSides!.includes(s));
  }
  return baseSides.map(s => rotateSide(s, comp.rotation));
}

/** Grid offset for a given side */
export function sideOffset(side: Side): { dx: number; dy: number } {
  switch (side) {
    case Side.North: return { dx: 0, dy: -1 };
    case Side.South: return { dx: 0, dy: 1 };
    case Side.East: return { dx: 1, dy: 0 };
    case Side.West: return { dx: -1, dy: 0 };
  }
}

/** Grid offset → side mapping */
function offsetToSide(dx: number, dy: number): Side {
  if (dx === 1) return Side.East;
  if (dx === -1) return Side.West;
  if (dy === 1) return Side.South;
  return Side.North;
}

/** Check if two grid-adjacent components can attach (both have attachable sides facing each other) */
export function canAttachRuntime(a: ComponentInstance, b: ComponentInstance): boolean {
  const dx = b.gridX - a.gridX;
  const dy = b.gridY - a.gridY;
  const sideFromA = offsetToSide(dx, dy);
  const aSides = getAttachableSides(a);
  const bSides = getAttachableSides(b);
  return aSides.includes(sideFromA) && bSides.includes(oppositeSide(sideFromA));
}

/** Build adjacency map for a set of components, respecting attachable sides */
export function buildComponentAdjacency(components: ComponentInstance[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const c of components) {
    adj.set(c.id, []);
  }
  for (let i = 0; i < components.length; i++) {
    for (let j = i + 1; j < components.length; j++) {
      const a = components[i];
      const b = components[j];
      const dx = Math.abs(a.gridX - b.gridX);
      const dy = Math.abs(a.gridY - b.gridY);
      if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) {
        if (canAttachRuntime(a, b)) {
          adj.get(a.id)!.push(b.id);
          adj.get(b.id)!.push(a.id);
        }
      }
    }
  }
  return adj;
}

/** Build adjacency then remove edges for unlatched decoupler sides */
export function buildLiveAdjacency(
  components: ComponentInstance[],
  unlatchedSides: Map<string, Side[]>,
): Map<string, string[]> {
  const adj = buildComponentAdjacency(components);
  const compById = new Map(components.map(c => [c.id, c]));

  for (const [compId, sides] of unlatchedSides) {
    const comp = compById.get(compId);
    if (!comp) continue;
    for (const side of sides) {
      const off = sideOffset(side);
      const nx = comp.gridX + off.dx;
      const ny = comp.gridY + off.dy;
      const neighbor = components.find(c => c.gridX === nx && c.gridY === ny);
      if (!neighbor) continue;
      // Remove edge in both directions
      const aList = adj.get(compId);
      if (aList) {
        const idx = aList.indexOf(neighbor.id);
        if (idx >= 0) aList.splice(idx, 1);
      }
      const bList = adj.get(neighbor.id);
      if (bList) {
        const idx = bList.indexOf(compId);
        if (idx >= 0) bList.splice(idx, 1);
      }
    }
  }
  return adj;
}

/** BFS from all connectivity anchors, return set of reachable component IDs */
export function bfsFromAnchors(
  components: ComponentInstance[],
  adj: Map<string, string[]>,
): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const c of components) {
    if (getComponentDef(c.type).isConnectivityAnchor) {
      visited.add(c.id);
      queue.push(c.id);
    }
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const neighborId of adj.get(id) ?? []) {
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push(neighborId);
      }
    }
  }
  return visited;
}

/** Check if a ship is a drone (has Radio/enablesDroneControl, no Command Module/anchor) */
export function isDrone(ship: ShipState): boolean {
  const hasRadio = ship.components.some(c => getComponentDef(c.type).enablesDroneControl && c.health > 0);
  const hasCmd = ship.components.some(c => getComponentDef(c.type).isConnectivityAnchor && c.health > 0);
  return hasRadio && !hasCmd;
}

/** Resolve ownership for a segment after split.
 *  - Has Command Module → keep previousOwner
 *  - Has Radio → keep previousOwner (drone)
 *  - Neither → null (space junk, isActive frozen)
 */
export function resolveSegmentOwner(
  components: ComponentInstance[],
  previousOwner: import('../entities/ComponentInstance').Owner,
): import('../entities/ComponentInstance').Owner {
  const hasCmd = components.some(c => getComponentDef(c.type).isConnectivityAnchor && c.health > 0);
  if (hasCmd) return previousOwner;
  const hasRadio = components.some(c => getComponentDef(c.type).enablesDroneControl && c.health > 0);
  if (hasRadio) return previousOwner;
  return null;
}
