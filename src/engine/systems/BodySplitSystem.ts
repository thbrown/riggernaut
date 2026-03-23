import RAPIER from '@dimforge/rapier2d-compat';
import { BattleSimulation, ShipState } from '../BattleSimulation';
import { getComponentDef } from '../../game/components';
import { ComponentInstance } from '../entities/ComponentInstance';
import { TILE_SIZE, COLLIDER_MARGIN } from '../../config/constants';

/** Split orphaned components off into new rigid bodies (space junk).
 *  Creates a new body for each connected cluster of orphans with momentum conservation.
 *  Optional clusterImpulses: per-cluster impulse overrides from the two-pass decoupler system. */
export function splitOrphansToNewBodies(
  sim: BattleSimulation,
  ship: ShipState,
  orphans: ComponentInstance[],
  adj: Map<string, string[]>,
  _clusterImpulses?: Array<{ fx: number; fy: number; px: number; py: number }>,
) {
  // Group orphans into connected clusters (they may split into multiple pieces)
  const orphanSet = new Set(orphans.map(c => c.id));
  const compById = new Map(orphans.map(c => [c.id, c]));
  const clustered = new Set<string>();
  const clusters: ComponentInstance[][] = [];

  for (const orphan of orphans) {
    if (clustered.has(orphan.id)) continue;
    const cluster: ComponentInstance[] = [];
    const q: string[] = [orphan.id];
    clustered.add(orphan.id);

    while (q.length > 0) {
      const cid = q.shift()!;
      cluster.push(compById.get(cid)!);
      for (const nid of adj.get(cid) ?? []) {
        if (orphanSet.has(nid) && !clustered.has(nid)) {
          clustered.add(nid);
          q.push(nid);
        }
      }
    }
    clusters.push(cluster);
  }

  // Create a new rigid body for each orphan cluster (space junk)
  const parentBody = sim.world.getRigidBody(ship.bodyHandle);
  if (!parentBody) return;
  const parentAngle = parentBody.rotation();
  const parentLinvel = parentBody.linvel();
  const parentAngvel = parentBody.angvel();

  for (const cluster of clusters) {
    // Compute centroid of cluster in world space
    let cx = 0, cy = 0;
    for (const c of cluster) {
      const col = sim.world.getCollider(c.colliderHandle);
      if (col) {
        const wp = col.translation();
        cx += wp.x;
        cy += wp.y;
      }
    }
    cx /= cluster.length;
    cy /= cluster.length;

    // Offset from parent COM to cluster centroid
    const parentCom = parentBody.translation();
    const rx = cx - parentCom.x;
    const ry = cy - parentCom.y;
    // ω × r tangential velocity contribution (2D cross product)
    const tangentialVx = -parentAngvel * ry;
    const tangentialVy =  parentAngvel * rx;

    // Create new body at cluster centroid with momentum-conserving velocity
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(cx, cy)
      .setRotation(parentAngle)
      .setLinvel(parentLinvel.x + tangentialVx, parentLinvel.y + tangentialVy)
      .setAngvel(parentAngvel)
      .setAngularDamping(0)
      .setLinearDamping(0)
      .setCanSleep(false);
    const newBody = sim.world.createRigidBody(bodyDesc);

    // Un-rotate world offsets into body-local frame
    const cosA = Math.cos(-parentAngle);
    const sinA = Math.sin(-parentAngle);

    // Move colliders to new body
    for (const comp of cluster) {
      const oldCollider = sim.world.getCollider(comp.colliderHandle);
      if (!oldCollider) continue;

      const worldPos = oldCollider.translation();
      // World-space offset from centroid
      const dx = worldPos.x - cx;
      const dy = worldPos.y - cy;
      // Rotate into body-local frame (inverse of parentAngle)
      const localX = dx * cosA - dy * sinA;
      const localY = dx * sinA + dy * cosA;

      // Remove old collider
      sim.world.removeCollider(oldCollider, true);

      // Create new collider on new body — normal collision group
      const colliderDesc = RAPIER.ColliderDesc.cuboid(TILE_SIZE / 2 - COLLIDER_MARGIN, TILE_SIZE / 2 - COLLIDER_MARGIN)
        .setTranslation(localX, localY)
        .setDensity(getComponentDef(comp.type).mass)
        .setFriction(0)
        .setCollisionGroups((0x0001 << 16) | 0xFFFF)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const newCollider = sim.world.createCollider(colliderDesc, newBody);

      // Update component references
      const oldHandle = comp.colliderHandle;
      comp.colliderHandle = newCollider.handle;
      comp.bodyHandle = newBody.handle;
      sim.colliderToComponent.delete(oldHandle);
      sim.colliderToComponent.set(newCollider.handle, comp);
      sim.colliderToShip.delete(oldHandle);
    }

    // Register as a new "ship" (space junk — no AI, not player)
    const junkShip: ShipState = {
      bodyHandle: newBody.handle,
      components: cluster,
      isPlayer: false,
      prevPosition: { x: cx, y: cy },
      prevAngle: parentAngle,
      bodyInterp: new Map([[newBody.handle, { prevPos: { x: cx, y: cy }, prevAngle: parentAngle }]]),
    };
    for (const comp of cluster) {
      sim.colliderToShip.set(comp.colliderHandle, junkShip);
    }
    sim.ships.push(junkShip);
  }
}
