import { BattleSimulation } from '../BattleSimulation';
import { Side } from '../../types/components';
import { getComponentDef } from '../../game/components';
import { rotateSide } from '../../types/grid';
import {
  ENGINE_EXHAUST_PUSH_FORCE,
  TILE_SIZE, FIXED_TIMESTEP,
} from '../../config/constants';

/** Apply exhaust damage from active engines to nearby components */
export function processExhaustDamage(sim: BattleSimulation) {
  for (const ship of sim.ships) {
    for (const comp of ship.components) {
      if (comp.health <= 0) continue;

      const def = getComponentDef(comp.type);
      if (def.config.kind !== 'engine') continue;

      if (!comp.isActive) continue;

      const body = sim.world.getRigidBody(comp.bodyHandle);
      if (!body) continue;

      const collider = sim.world.getCollider(comp.colliderHandle);
      if (!collider) continue;

      const enginePos = collider.translation();

      const functionalSide = def.functionalSide ?? Side.South;
      const exhaustSide = rotateSide(functionalSide, comp.rotation);

      // Exhaust direction in local space
      let edx = 0, edy = 0;
      switch (exhaustSide) {
        case Side.North: edx = 0; edy = -1; break;
        case Side.South: edx = 0; edy = 1; break;
        case Side.East: edx = 1; edy = 0; break;
        case Side.West: edx = -1; edy = 0; break;
      }

      // Rotate by body angle
      const angle = body.rotation();
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const worldEdx = edx * cos - edy * sin;
      const worldEdy = edx * sin + edy * cos;

      // Perpendicular axis (rotated 90° CW from exhaust direction)
      const worldPerpX = -worldEdy;
      const worldPerpY = worldEdx;

      // Exhaust origin: offset 0.5 tiles from collider center in exhaust direction
      const originX = enginePos.x + worldEdx * 0.5 * TILE_SIZE;
      const originY = enginePos.y + worldEdy * 0.5 * TILE_SIZE;

      const { semiMajor, semiMinor } = def.config.exhaustShape;
      const dps = def.config.exhaustDps;

      // Accumulate reaction forces from all blocked exhaust (Newton's 3rd law)
      let reactionForceX = 0;
      let reactionForceY = 0;

      // Check all components (including own ship, but not the engine itself)
      for (const targetShip of sim.ships) {
        for (const target of targetShip.components) {
          // Skip the engine component itself — engines don't damage themselves
          if (target === comp) continue;
          if (target.health <= 0) continue;

          const targetCollider = sim.world.getCollider(target.colliderHandle);
          if (!targetCollider) continue;

          const targetPos = targetCollider.translation();
          const dx = targetPos.x - originX;
          const dy = targetPos.y - originY;

          // Project onto exhaust axes
          const along = dx * worldEdx + dy * worldEdy;
          if (along <= 0) continue; // behind exhaust origin

          const perp = dx * worldPerpX + dy * worldPerpY;

          // Elliptical distance
          const na = along / (semiMajor * TILE_SIZE);
          const nb = perp / (semiMinor * TILE_SIZE);
          const d = Math.sqrt(na * na + nb * nb);
          if (d > 1) continue;

          const falloff = 1 - d;

          // Apply damage
          const dmg = dps * FIXED_TIMESTEP * falloff;
          if (dmg > 0) { target.lastDamageTick = sim.tickCount; target.lastAttackerBodyHandle = body.handle; }
          target.health = Math.max(0, target.health - dmg);

          // Compute push strength for all targets (reaction force accumulation)
          const pushStrength = ENGINE_EXHAUST_PUSH_FORCE * falloff * FIXED_TIMESTEP;
          reactionForceX += worldEdx * pushStrength;
          reactionForceY += worldEdy * pushStrength;

          // Push force on target's own body
          const targetBody = sim.world.getRigidBody(target.bodyHandle);
          if (targetBody) {
            targetBody.applyImpulseAtPoint(
              { x: worldEdx * pushStrength, y: worldEdy * pushStrength },
              { x: targetPos.x, y: targetPos.y },
              true
            );
          }
        }
      }

      // Apply accumulated reaction force on the engine's body (Newton's 3rd law)
      if (reactionForceX !== 0 || reactionForceY !== 0) {
        body.applyImpulseAtPoint(
          { x: -reactionForceX, y: -reactionForceY },
          { x: enginePos.x, y: enginePos.y },
          true
        );
      }
    }
  }
}
