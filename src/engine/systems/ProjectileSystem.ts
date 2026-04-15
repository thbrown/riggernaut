import { BattleSimulation } from '../BattleSimulation';
import { Projectile, createProjectile } from '../entities/Projectile';
import { Side, BlasterConfig } from '../../types/components';
import { getComponentDef } from '../../game/components';
import { rotateSide } from '../../types/grid';
import { FIXED_TIMESTEP, TILE_SIZE } from '../../config/constants';
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

    for (const comp of ship.components) {
      if (comp.health <= 0) continue;
      if (!comp.isActive) continue;

      const def = getComponentDef(comp.type);
      if (def.config.kind !== 'blaster') continue;

      // Check cooldown
      const cooldown = fireCooldowns.get(comp.id) ?? 0;
      if (cooldown > 0) {
        fireCooldowns.set(comp.id, cooldown - FIXED_TIMESTEP);
        continue;
      }

      // Fire!
      const proj = spawnBolt(sim, shipIdx, comp, def.config);
      if (proj) {
        projectiles.push(proj);
        fireCooldowns.set(comp.id, 1 / def.config.fireRatePerSec);
        comp.lastFireTick = sim.tickCount;
      }
    }
  }
}

function spawnBolt(
  sim: BattleSimulation,
  shipIdx: number,
  comp: ComponentInstance,
  config: BlasterConfig,
): Projectile | null {
  const body = sim.world.getRigidBody(comp.bodyHandle);
  if (!body) return null;

  const collider = sim.world.getCollider(comp.colliderHandle);
  if (!collider) return null;

  const def = getComponentDef(comp.type);
  const functionalSide = def.functionalSide ?? Side.North;
  const fireSide = rotateSide(functionalSide, comp.rotation);

  let ldx = 0, ldy = 0;
  switch (fireSide) {
    case Side.North: ldx = 0; ldy = -1; break;
    case Side.South: ldx = 0; ldy = 1; break;
    case Side.East: ldx = 1; ldy = 0; break;
    case Side.West: ldx = -1; ldy = 0; break;
  }

  const angle = body.rotation();
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dirX = ldx * cos - ldy * sin;
  const dirY = ldx * sin + ldy * cos;

  const worldPos = collider.translation();
  const spawnX = worldPos.x + dirX * TILE_SIZE * 0.6;
  const spawnY = worldPos.y + dirY * TILE_SIZE * 0.6;

  body.applyImpulseAtPoint(
    { x: -dirX * config.kickback, y: -dirY * config.kickback },
    worldPos,
    true,
  );

  const bodyVel = body.linvel();
  const angvel = body.angvel();
  const com = body.translation();
  const rx = spawnX - com.x;
  const ry = spawnY - com.y;
  return createProjectile(shipIdx, comp.id, spawnX, spawnY, dirX, dirY, config,
    bodyVel.x + (-angvel * ry),
    bodyVel.y + (angvel * rx),
  );
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

    // Simple AABB collision with all components (no self-damage)
    for (let si = 0; si < sim.ships.length; si++) {
      // Skip the entire ship that fired this bolt
      if (si === proj.ownerShipIndex) continue;
      const ship = sim.ships[si];
      for (const comp of ship.components) {
        if (comp.health <= 0) continue;
        const collider = sim.world.getCollider(comp.colliderHandle);
        if (!collider) continue;

        const cPos = collider.translation();
        const halfTile = TILE_SIZE / 2;
        if (Math.abs(proj.x - cPos.x) < halfTile && Math.abs(proj.y - cPos.y) < halfTile) {
          // Hit!
          comp.health = Math.max(0, comp.health - proj.damage);
          comp.lastDamageTick = sim.tickCount;
          // Attribute damage to the ship that fired this projectile
          const ownerShip = sim.ships[proj.ownerShipIndex];
          if (ownerShip) comp.lastAttackerBodyHandle = ownerShip.bodyHandle;
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
