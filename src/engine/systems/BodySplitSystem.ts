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

  for (const cluster of clusters) {
    // Determine the actual body these components live on
    const clusterBodyHandle = cluster[0].bodyHandle;
    const clusterBody = sim.world.getRigidBody(clusterBodyHandle);
    const actualBody = clusterBody ?? parentBody;
    const actualAngle = actualBody.rotation();
    const actualLinvel = actualBody.linvel();
    const actualAngvel = actualBody.angvel();

    // Check if this cluster's body is a separate section body (hinged ship)
    // and no remaining ship components share it — if so, reuse the body directly
    const isOnSeparateBody = clusterBodyHandle !== ship.bodyHandle;
    const bodyStillUsedByShip = isOnSeparateBody &&
      ship.components.some(c => c.bodyHandle === clusterBodyHandle);

    if (isOnSeparateBody && !bodyStillUsedByShip && clusterBody) {
      // Reuse existing body — no need to recreate colliders.
      // Just detach from parent ship and register as junk.
      const pos = clusterBody.translation();
      ship.bodyInterp?.delete(clusterBodyHandle);

      const junkShip: ShipState = {
        bodyHandle: clusterBodyHandle,
        components: cluster,
        isPlayer: false,
        prevPosition: { x: pos.x, y: pos.y },
        prevAngle: actualAngle,
        bodyInterp: new Map([[clusterBodyHandle, { prevPos: { x: pos.x, y: pos.y }, prevAngle: actualAngle }]]),
      };
      for (const comp of cluster) {
        sim.colliderToShip.delete(comp.colliderHandle);
        sim.colliderToShip.set(comp.colliderHandle, junkShip);
      }
      sim.ships.push(junkShip);
      continue;
    }

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

    // Offset from actual body COM to cluster centroid
    const bodyCom = actualBody.translation();
    const rx = cx - bodyCom.x;
    const ry = cy - bodyCom.y;
    // ω × r tangential velocity contribution (2D cross product)
    const tangentialVx = -actualAngvel * ry;
    const tangentialVy =  actualAngvel * rx;

    // Create new body at cluster centroid with momentum-conserving velocity
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(cx, cy)
      .setRotation(actualAngle)
      .setLinvel(actualLinvel.x + tangentialVx, actualLinvel.y + tangentialVy)
      .setAngvel(actualAngvel)
      .setAngularDamping(0)
      .setLinearDamping(0)
      .setCanSleep(false);
    const newBody = sim.world.createRigidBody(bodyDesc);

    // Un-rotate world offsets into body-local frame
    const cosA = Math.cos(-actualAngle);
    const sinA = Math.sin(-actualAngle);

    // Move colliders to new body
    for (const comp of cluster) {
      const oldCollider = sim.world.getCollider(comp.colliderHandle);
      if (!oldCollider) continue;

      const worldPos = oldCollider.translation();
      // World-space offset from centroid
      const dx = worldPos.x - cx;
      const dy = worldPos.y - cy;
      // Rotate into body-local frame (inverse of actualAngle)
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
      prevAngle: actualAngle,
      bodyInterp: new Map([[newBody.handle, { prevPos: { x: cx, y: cy }, prevAngle: actualAngle }]]),
    };
    for (const comp of cluster) {
      sim.colliderToShip.set(comp.colliderHandle, junkShip);
    }
    sim.ships.push(junkShip);
  }
}
