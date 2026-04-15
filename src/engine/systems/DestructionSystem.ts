import { BattleSimulation, ShipState } from '../BattleSimulation';
import { getComponentDef } from '../../game/components';
import { TILE_SIZE, PIXELS_PER_METER } from '../../config/constants';
import { spawnExplosionParticles } from '../ParticleSystem';
import { resolveSegmentOwner } from './ConnectivitySystem';
import { splitOrphansToNewBodies } from './BodySplitSystem';
import { ConnectionGraph } from './ConnectionGraph';

/** Remove destroyed components (health <= 0) and handle disconnection */
export function processDestruction(sim: BattleSimulation) {
  for (const ship of sim.ships) {
    const destroyed: import('../entities/ComponentInstance').ComponentInstance[] = [];

    for (const comp of ship.components) {
      if (comp.health <= 0) {
        destroyed.push(comp);
      }
    }

    for (const comp of destroyed) {
      // Record killer chain: when an anchor dies, record who killed it
      // Skip self-damage (same ship body) — only record cross-ship kills
      if (getComponentDef(comp.type).isConnectivityAnchor
          && comp.lastAttackerBodyHandle !== undefined
          && comp.lastAttackerBodyHandle !== ship.bodyHandle) {
        if (!sim.killerChain.has(ship.bodyHandle)) {
          sim.killerChain.set(ship.bodyHandle, comp.lastAttackerBodyHandle);
        }
      }

      // Get body velocity for destruction particles (per-component body)
      const compBody = sim.world.getRigidBody(comp.bodyHandle);
      const bodyVel = compBody?.linvel();
      const baseVx = (bodyVel?.x ?? 0) * PIXELS_PER_METER;
      const baseVy = (bodyVel?.y ?? 0) * PIXELS_PER_METER;

      // Spawn small destruction explosion at component position
      const collider = sim.world.getCollider(comp.colliderHandle);
      if (collider) {
        const pos = collider.translation();
        spawnExplosionParticles(
          pos.x * PIXELS_PER_METER,
          pos.y * PIXELS_PER_METER,
          TILE_SIZE * PIXELS_PER_METER * 0.5,
          0.3,
          baseVx,
          baseVy,
        );
        sim.world.removeCollider(collider, true);
      }
      sim.colliderToComponent.delete(comp.colliderHandle);
      sim.colliderToShip.delete(comp.colliderHandle);
    }

    // Remove destroyed components from ship
    if (destroyed.length > 0) {
      ship.components = ship.components.filter(c => c.health > 0);

      // Clean up hinge joints for destroyed hinge components
      for (const comp of destroyed) {
        const idx = sim.hingeJoints.findIndex(hj => hj.hingeCompId === comp.id);
        if (idx !== -1) {
          const hj = sim.hingeJoints[idx];
          const joint = sim.world.getImpulseJoint(hj.jointHandle);
          if (joint) sim.world.removeImpulseJoint(joint, true);
          sim.hingeJoints.splice(idx, 1);
        }
      }
      // Also remove joints where one side has no living components
      sim.hingeJoints = sim.hingeJoints.filter(hj => {
        const hasA = ship.components.some(c => c.bodyHandle === hj.bodyAHandle);
        const hasB = ship.components.some(c => c.bodyHandle === hj.bodyBHandle);
        if (!hasA || !hasB) {
          const joint = sim.world.getImpulseJoint(hj.jointHandle);
          if (joint) sim.world.removeImpulseJoint(joint, true);
          return false;
        }
        return true;
      });

      // Disconnection detection: BFS from Command Module, orphans become space junk
      detectDisconnection(sim, ship);
    }
  }
}

/** Public wrapper: split disconnected sections off a ship (e.g. at init time) */
export function detectAndSplitDisconnected(sim: BattleSimulation, ship: ShipState) {
  detectDisconnection(sim, ship);
}

/** Use ConnectionGraph to find disconnected components; orphans become new rigid bodies (space junk) */
function detectDisconnection(sim: BattleSimulation, ship: ShipState) {
  if (ship.components.length === 0) return;

  // Get or create connection graph
  let graph = sim.connectionGraphs.get(ship.bodyHandle);
  if (!graph) {
    // Fallback: build from current state
    const unlatchedSides = new Map<string, import('../../types/components').Side[]>();
    for (const dc of sim.decouplers) {
      const sides = dc.sides.filter(s => s.mode !== 'latched').map(s => s.side);
      if (sides.length > 0) unlatchedSides.set(dc.compId, sides);
    }
    graph = ConnectionGraph.fromComponents(ship.components, unlatchedSides);
    sim.connectionGraphs.set(ship.bodyHandle, graph);
  }

  // Sync graph with living components — dead nodes may not be health<=0 here
  // because ship.components is already filtered before detectDisconnection is called
  const livingIds = new Set(ship.components.map(c => c.id));
  graph.syncWithLiving(livingIds);

  const reachable = graph.getReachableFromAnchors(ship.components);

  // Collect orphaned components (not reachable from any anchor)
  const orphans = ship.components.filter(c => !reachable.has(c.id));
  if (orphans.length === 0) return;

  // Remove orphans from original ship
  ship.components = ship.components.filter(c => reachable.has(c.id));

  const adj = graph.toAdjMap();
  splitOrphansToNewBodies(sim, ship, orphans, adj);

  // Use camera system for smooth transition instead of snapping prevCom
  if (ship.isPlayer) {
    const comPos = sim.getPlayerBodyPosition();
    if (comPos) sim.camera.onMassChange(comPos);
  }

  // Remove orphan nodes from parent ship's graph
  for (const orphan of orphans) {
    graph.removeComponent(orphan.id);
  }

  // Resolve ownership and create subgraphs for new ships
  const previousOwner = orphans[0]?.owner ?? null;
  for (const s of sim.ships) {
    if (!orphans.some(o => s.components.includes(o))) continue;
    const newOwner = resolveSegmentOwner(s.components, previousOwner);
    for (const c of s.components) {
      c.owner = newOwner;
    }
    // Create connection graph for the split-off ship
    const subgraph = ConnectionGraph.fromComponents(s.components);
    sim.connectionGraphs.set(s.bodyHandle, subgraph);
  }
}
