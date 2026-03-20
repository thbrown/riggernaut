import { BattleSimulation } from '../BattleSimulation';
import { Projectile, createProjectile, blasterSizeFromType } from '../entities/Projectile';
import { Side } from '../../types/components';
import { getComponentDef } from '../../game/component-registry';
import { rotateSide } from '../../types/grid';
import { BLASTER_STATS, FIXED_TIMESTEP, TILE_SIZE } from '../../config/constants';
import { ComponentInstance } from '../entities/ComponentInstance';

/** Track fire cooldowns per component id */
const fireCooldowns = new Map<string, number>();

export function clearCooldowns() { fireCooldowns.clear(); }

export function processBlasterFire(
  sim: BattleSimulation,
  projectiles: Projectile[],
) {
  for (let shipIdx = 0; shipIdx < sim.ships.length; shipIdx++) {
    const ship = sim.ships[shipIdx];

    const body = sim.world.getRigidBody(ship.bodyHandle);
    if (!body) continue;

    for (const comp of ship.components) {
      if (comp.health <= 0) continue;
      if (!comp.isActive) continue;

      const size = blasterSizeFromType(comp.type);
      if (!size) continue;

      // Check cooldown
      const cooldown = fireCooldowns.get(comp.id) ?? 0;
      if (cooldown > 0) {
        fireCooldowns.set(comp.id, cooldown - FIXED_TIMESTEP);
        continue;
      }

      // Fire!
      const proj = spawnBolt(sim, shipIdx, comp, size);
      if (proj) {
        projectiles.push(proj);
        fireCooldowns.set(comp.id, 1 / BLASTER_STATS[size].fireRatePerSec);
        comp.lastFireTick = sim.tickCount;
      }
    }
  }
}

function spawnBolt(
  sim: BattleSimulation,
  shipIdx: number,
  comp: ComponentInstance,
  size: 'small' | 'medium' | 'large',
): Projectile | null {
  const body = sim.world.getRigidBody(sim.ships[shipIdx].bodyHandle);
  if (!body) return null;

  const collider = sim.world.getCollider(comp.colliderHandle);
  if (!collider) return null;

  const def = getComponentDef(comp.type);
  const functionalSide = def.functionalSide ?? Side.North;
  const fireSide = rotateSide(functionalSide, comp.rotation);

  // Direction in local space
  let ldx = 0, ldy = 0;
  switch (fireSide) {
    case Side.North: ldx = 0; ldy = -1; break;
    case Side.South: ldx = 0; ldy = 1; break;
    case Side.East: ldx = 1; ldy = 0; break;
    case Side.West: ldx = -1; ldy = 0; break;
  }

  // Rotate by body angle
  const angle = body.rotation();
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dirX = ldx * cos - ldy * sin;
  const dirY = ldx * sin + ldy * cos;

  // Spawn position: component world position + offset in fire direction
  const worldPos = collider.translation();
  const spawnX = worldPos.x + dirX * TILE_SIZE * 0.6;
  const spawnY = worldPos.y + dirY * TILE_SIZE * 0.6;

  // Apply kickback impulse at blaster position (opposite to fire direction)
  const stats = BLASTER_STATS[size];
  body.applyImpulseAtPoint(
    { x: -dirX * stats.kickback, y: -dirY * stats.kickback },
    worldPos,
    true,
  );

  const bodyVel = body.linvel();
  return createProjectile(shipIdx, comp.id, spawnX, spawnY, dirX, dirY, size, bodyVel.x, bodyVel.y);
}

/** Move projectiles and check for collisions */
export function updateProjectiles(sim: BattleSimulation, projectiles: Projectile[], dt: number) {
  for (const proj of projectiles) {
    if (!proj.alive) continue;

    // Move
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;
    proj.distanceTraveled += Math.sqrt(proj.vx * proj.vx + proj.vy * proj.vy) * dt;

    // Max range check
    if (proj.distanceTraveled > proj.maxRange) {
      proj.alive = false;
      continue;
    }

    // Simple AABB collision with all components (friendly fire enabled)
    for (let si = 0; si < sim.ships.length; si++) {
      const ship = sim.ships[si];
      for (const comp of ship.components) {
        if (comp.health <= 0) continue;
        // Skip the blaster that fired this bolt
        if (comp.id === proj.ownerCompId) continue;
        const collider = sim.world.getCollider(comp.colliderHandle);
        if (!collider) continue;

        const cPos = collider.translation();
        const halfTile = TILE_SIZE / 2;
        if (Math.abs(proj.x - cPos.x) < halfTile && Math.abs(proj.y - cPos.y) < halfTile) {
          // Hit!
          comp.health = Math.max(0, comp.health - proj.damage);
          comp.lastDamageTick = sim.tickCount;
          proj.alive = false;
          break;
        }
      }
      if (!proj.alive) break;
    }
  }

  // Remove dead projectiles
  for (let i = projectiles.length - 1; i >= 0; i--) {
    if (!projectiles[i].alive) {
      projectiles.splice(i, 1);
    }
  }
}
