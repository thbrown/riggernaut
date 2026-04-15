import { BattleSimulation } from '../BattleSimulation';
import { getComponentDef } from '../../game/components';
import { COLLISION_DAMAGE_SCALAR, MIN_COLLISION_SPEED, TILE_SIZE } from '../../config/constants';

/** Track which collider pairs we've already processed damage for this tick */
const processedPairs = new Set<string>();

/** Process collision events and apply damage */
export function processCollisionDamage(sim: BattleSimulation, events: Array<[number, number, boolean]>) {
  processedPairs.clear();

  for (const [h1, h2, started] of events) {
    if (!started) continue; // Only process collision start

    const comp1 = sim.colliderToComponent.get(h1);
    const comp2 = sim.colliderToComponent.get(h2);

    if (!comp1 || !comp2) continue;
    if (comp1.health <= 0 || comp2.health <= 0) continue;

    // Deduplicate
    const pairKey = h1 < h2 ? `${h1}:${h2}` : `${h2}:${h1}`;
    if (processedPairs.has(pairKey)) continue;
    processedPairs.add(pairKey);

    // Get the colliders for velocity computation
    const collider1 = sim.world.getCollider(h1);
    const collider2 = sim.world.getCollider(h2);
    if (!collider1 || !collider2) continue;

    const body1 = sim.world.getRigidBody(collider1.parent()!.handle);
    const body2 = sim.world.getRigidBody(collider2.parent()!.handle);
    if (!body1 || !body2) continue;

    // Skip if same body
    if (body1.handle === body2.handle) continue;

    // Skip damage (but not physics) for same-ship collisions (e.g. hinged sections)
    const ship1 = sim.colliderToShip.get(h1);
    const ship2 = sim.colliderToShip.get(h2);
    if (ship1 && ship2 && ship1 === ship2) continue;

    // Compute relative velocity
    const v1 = body1.linvel();
    const v2 = body2.linvel();
    const relVx = v1.x - v2.x;
    const relVy = v1.y - v2.y;
    const relSpeed = Math.sqrt(relVx * relVx + relVy * relVy);

    const def1 = getComponentDef(comp1.type);
    const def2 = getComponentDef(comp2.type);

    // Minimum speed threshold (bypassed if either component ignores the deadzone)
    const ignoreDeadzone = def1.ignoreCollisionDamageDeadzone?.() || def2.ignoreCollisionDamageDeadzone?.();
    if (!ignoreDeadzone && relSpeed < MIN_COLLISION_SPEED * TILE_SIZE) continue;

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

    if (dmg1 > 0) { comp1.health = Math.max(0, comp1.health - dmg1); comp1.lastDamageTick = sim.tickCount; comp1.lastAttackerBodyHandle = body2.handle; }
    if (dmg2 > 0) { comp2.health = Math.max(0, comp2.health - dmg2); comp2.lastDamageTick = sim.tickCount; comp2.lastAttackerBodyHandle = body1.handle; }
  }
}
