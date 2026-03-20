import RAPIER from '@dimforge/rapier2d-compat';
import { BattleSimulation, ShipState } from '../BattleSimulation';
import { ComponentType } from '../../types/components';
import { getComponentDef } from '../../game/component-registry';
import { COLLISION_DAMAGE_SCALAR, MIN_COLLISION_SPEED, TILE_SIZE, PIXELS_PER_METER } from '../../config/constants';
import { ComponentInstance } from '../entities/ComponentInstance';
import { spawnExplosionParticles } from '../ParticleSystem';
import { isDrone } from './RadioSystem';

/** Track which collider pairs we've already processed damage for this tick */
const processedPairs = new Set<string>();

/** Process collision events and apply damage */
export function processCollisionDamage(sim: BattleSimulation) {
  processedPairs.clear();

  sim.eventQueue.drainCollisionEvents((h1, h2, started) => {
    if (!started) return; // Only process collision start

    const comp1 = sim.colliderToComponent.get(h1);
    const comp2 = sim.colliderToComponent.get(h2);

    if (!comp1 || !comp2) return;
    if (comp1.health <= 0 || comp2.health <= 0) return;

    // Deduplicate
    const pairKey = h1 < h2 ? `${h1}:${h2}` : `${h2}:${h1}`;
    if (processedPairs.has(pairKey)) return;
    processedPairs.add(pairKey);

    // Get the colliders for velocity computation
    const collider1 = sim.world.getCollider(h1);
    const collider2 = sim.world.getCollider(h2);
    if (!collider1 || !collider2) return;

    const body1 = sim.world.getRigidBody(collider1.parent()!.handle);
    const body2 = sim.world.getRigidBody(collider2.parent()!.handle);
    if (!body1 || !body2) return;

    // Skip if same body
    if (body1.handle === body2.handle) return;

    // Compute relative velocity
    const v1 = body1.linvel();
    const v2 = body2.linvel();
    const relVx = v1.x - v2.x;
    const relVy = v1.y - v2.y;
    const relSpeed = Math.sqrt(relVx * relVx + relVy * relVy);

    // Minimum speed threshold
    if (relSpeed < MIN_COLLISION_SPEED * TILE_SIZE) return;

    const def1 = getComponentDef(comp1.type);
    const def2 = getComponentDef(comp2.type);

    // Use actual rigid body mass for proper collision damage
    const m1 = body1.mass();
    const m2 = body2.mass();
    const reducedMass = (m1 * m2) / (m1 + m2);

    // Relative kinetic energy
    const relKE = 0.5 * reducedMass * relSpeed * relSpeed;
    const rawDamage = COLLISION_DAMAGE_SCALAR * relKE;

    // Split by hardness
    const totalHardness = def1.hardness + def2.hardness;
    const dmg1 = rawDamage * (def2.hardness / totalHardness);
    const dmg2 = rawDamage * (def1.hardness / totalHardness);

    if (dmg1 > 0) { comp1.health = Math.max(0, comp1.health - dmg1); comp1.lastDamageTick = sim.tickCount; }
    if (dmg2 > 0) { comp2.health = Math.max(0, comp2.health - dmg2); comp2.lastDamageTick = sim.tickCount; }
  });
}

/** Remove destroyed components (health <= 0) and handle disconnection */
export function processDestruction(sim: BattleSimulation) {
  for (const ship of sim.ships) {
    const destroyed: ComponentInstance[] = [];

    for (const comp of ship.components) {
      if (comp.health <= 0) {
        destroyed.push(comp);
      }
    }

    // Get body velocity for destruction particles
    const body = sim.world.getRigidBody(ship.bodyHandle);
    const bodyVel = body?.linvel();
    const baseVx = (bodyVel?.x ?? 0) * PIXELS_PER_METER;
    const baseVy = (bodyVel?.y ?? 0) * PIXELS_PER_METER;

    for (const comp of destroyed) {
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
    }

    // Remove destroyed components from ship
    if (destroyed.length > 0) {
      ship.components = ship.components.filter(c => c.health > 0);
      // Disconnection detection: BFS from Command Module, orphans become space junk
      detectDisconnection(sim, ship);
    }
  }
}

/** BFS adjacency check: two components are adjacent if grid distance == 1 */
function areAdjacent(a: ComponentInstance, b: ComponentInstance): boolean {
  const dx = Math.abs(a.gridX - b.gridX);
  const dy = Math.abs(a.gridY - b.gridY);
  return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
}

/** Public wrapper: split disconnected sections off a ship (e.g. at init time) */
export function detectAndSplitDisconnected(sim: BattleSimulation, ship: ShipState) {
  detectDisconnection(sim, ship);
}

/** BFS from Command Modules to find connected components; orphans become new rigid bodies (space junk) */
function detectDisconnection(sim: BattleSimulation, ship: ShipState) {
  if (ship.components.length === 0) return;

  // Build adjacency
  const adj = new Map<string, string[]>();
  for (const c of ship.components) {
    adj.set(c.id, []);
  }
  for (let i = 0; i < ship.components.length; i++) {
    for (let j = i + 1; j < ship.components.length; j++) {
      const a = ship.components[i];
      const b = ship.components[j];
      if (areAdjacent(a, b)) {
        adj.get(a.id)!.push(b.id);
        adj.get(b.id)!.push(a.id);
      }
    }
  }

  // BFS from Command Modules only (Radio sections can detach to become drones)
  const visited = new Set<string>();
  const queue: string[] = [];
  const compById = new Map<string, ComponentInstance>();
  for (const c of ship.components) {
    compById.set(c.id, c);
    if (c.type === ComponentType.CommandModule) {
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

  // Collect orphaned components (not reachable from any Command Module/Radio)
  const orphans = ship.components.filter(c => !visited.has(c.id));
  if (orphans.length === 0) return;

  // Remove orphans from original ship
  ship.components = ship.components.filter(c => visited.has(c.id));

  splitOrphansToNewBodies(sim, ship, orphans, adj);

  // Set owner on orphaned ships: space junk → null, drones → keep owner
  for (const s of sim.ships) {
    if (orphans.some(o => s.components.includes(o)) && !isDrone(s)) {
      for (const c of s.components) {
        c.owner = null;
      }
    }
  }
}

/** Split orphaned components off into new rigid bodies (space junk).
 *  Exported so DecouplerSystem can reuse this logic. */
export function splitOrphansToNewBodies(
  sim: BattleSimulation,
  ship: ShipState,
  orphans: ComponentInstance[],
  adj: Map<string, string[]>,
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
      const colliderDesc = RAPIER.ColliderDesc.cuboid(TILE_SIZE / 2, TILE_SIZE / 2)
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
    }

    // Register as a new "ship" (space junk — no AI, not player)
    const junkShip: ShipState = {
      bodyHandle: newBody.handle,
      components: cluster,
      isPlayer: false,
      prevPosition: { x: cx, y: cy },
      prevAngle: parentAngle,
    };
    sim.ships.push(junkShip);
  }
}

/** Check win/loss conditions */
export function checkWinLoss(sim: BattleSimulation): void {
  if (sim.gameOver) return;

  const playerShip = sim.ships.find(s => s.isPlayer);
  const enemyShips = sim.ships.filter(s => !s.isPlayer);

  const playerAlive = playerShip
    ? playerShip.components.some(c => c.type === ComponentType.CommandModule && c.health > 0)
    : false;

  const anyEnemyAlive = enemyShips.some(ship =>
    ship.components.some(c => c.type === ComponentType.CommandModule && c.health > 0)
  );

  if (!playerAlive && !anyEnemyAlive) {
    sim.gameOver = true;
    sim.winner = 'draw';
  } else if (!playerAlive) {
    sim.gameOver = true;
    sim.winner = 'enemy';
  } else if (!anyEnemyAlive && enemyShips.length > 0) {
    sim.gameOver = true;
    sim.winner = 'player';
  }
}
