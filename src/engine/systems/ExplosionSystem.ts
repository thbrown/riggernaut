import RAPIER from '@dimforge/rapier2d-compat';
import { BattleSimulation } from '../BattleSimulation';
import { ComponentInstance } from '../entities/ComponentInstance';
import { ComponentType } from '../../types/components';
import {
  EXPLOSION_DAMAGE, EXPLOSION_RADIUS, EXPLOSION_CHAIN_MULTIPLIER,
  EXPLOSION_RAY_COUNT, EXPLOSION_RAY_DAMAGE_SCALE,
  EXPLOSION_FORCE_RADIUS, EXPLOSION_FORCE_STRENGTH,
  EXPLOSION_FORCE_RAY_COUNT, EXPLOSION_REDIRECT_EFFICIENCY,
  TILE_SIZE, PIXELS_PER_METER,
} from '../../config/constants';
import { EXPLOSION_GLOW_MAX_AGE } from '../../config/display';

export interface Explosion {
  x: number;
  y: number;
  radius: number;
  damage: number;
  /** Normalized age 0..1 for rendering */
  age: number;
  maxAge: number;
}

/** Active visual explosions for rendering */
export const activeExplosions: Explosion[] = [];

export function clearExplosions() { activeExplosions.length = 0; }

/** Detonate an explosive component */
export function detonateExplosive(
  sim: BattleSimulation,
  comp: ComponentInstance,
  chainMultiplier: number = 1,
) {
  const collider = sim.world.getCollider(comp.colliderHandle);
  if (!collider) return;
  const pos = collider.translation();

  const radius = EXPLOSION_RADIUS * TILE_SIZE * chainMultiplier;
  const damage = EXPLOSION_DAMAGE * chainMultiplier;
  const forceRadius = EXPLOSION_FORCE_RADIUS * TILE_SIZE * chainMultiplier;
  const energyPerRay = damage * EXPLOSION_RAY_DAMAGE_SCALE / EXPLOSION_RAY_COUNT;

  // Visual explosion
  activeExplosions.push({
    x: pos.x,
    y: pos.y,
    radius: radius * PIXELS_PER_METER,
    damage,
    age: 0,
    maxAge: EXPLOSION_GLOW_MAX_AGE,
  });

  const detonationQueue: Array<{ comp: ComponentInstance; mult: number }> = [];
  const queuedIds = new Set<string>();

  // === DAMAGE PASS: multi-ray fan ===
  for (let i = 0; i < EXPLOSION_RAY_COUNT; i++) {
    const angle = (i * 2 * Math.PI) / EXPLOSION_RAY_COUNT;
    const ray = new RAPIER.Ray(
      { x: pos.x, y: pos.y },
      { x: Math.cos(angle), y: Math.sin(angle) },
    );

    const hits: Array<{ target: ComponentInstance; toi: number }> = [];
    sim.world.intersectionsWithRay(ray, radius, true, (intersect: RAPIER.RayColliderIntersection) => {
      if (intersect.collider.handle === comp.colliderHandle) return true;
      const target = sim.colliderToComponent.get(intersect.collider.handle);
      if (!target) return true;
      hits.push({ target, toi: intersect.timeOfImpact });
      return true;
    });

    hits.sort((a, b) => a.toi - b.toi);
    let remainingEnergy = energyPerRay;

    for (const hit of hits) {
      if (hit.toi >= radius || remainingEnergy <= 0) break;

      // Dead: ray passes through freely
      if (hit.target.health <= 0) continue;

      const falloff = Math.pow(1 - hit.toi / radius, 2);
      const actualDamage = Math.min(energyPerRay * falloff, remainingEnergy);
      const prevHealth = hit.target.health;
      hit.target.health = Math.max(0, hit.target.health - actualDamage);
      const dealt = prevHealth - hit.target.health;
      if (dealt > 0) hit.target.lastDamageTick = sim.tickCount;

      if (hit.target.health <= 0) {
        // Destroyed — chain if explosive
        if (hit.target.type === ComponentType.Explosive && !queuedIds.has(hit.target.id)) {
          queuedIds.add(hit.target.id);
          detonationQueue.push({
            comp: hit.target,
            mult: chainMultiplier * EXPLOSION_CHAIN_MULTIPLIER,
          });
        }
        remainingEnergy -= dealt;
      } else {
        break; // survived — ray absorbed
      }
    }
  }

  // === SECTOR ANALYSIS: continuous blockedness (0 = open, 1 = fully blocked) ===
  const sectorBlockedness: number[] = new Array(EXPLOSION_FORCE_RAY_COUNT).fill(0);

  for (let i = 0; i < EXPLOSION_FORCE_RAY_COUNT; i++) {
    const angle = (i * 2 * Math.PI) / EXPLOSION_FORCE_RAY_COUNT;
    const ray = new RAPIER.Ray(
      { x: pos.x, y: pos.y },
      { x: Math.cos(angle), y: Math.sin(angle) },
    );
    sim.world.intersectionsWithRay(ray, forceRadius, true, (intersect: RAPIER.RayColliderIntersection) => {
      if (intersect.collider.handle === comp.colliderHandle) return true;
      const target = sim.colliderToComponent.get(intersect.collider.handle);
      if (target && target.health > 0) {
        sectorBlockedness[i] = 1 - intersect.timeOfImpact / forceRadius;
        return false; // first surviving hit determines blockedness
      }
      return true;
    });
  }

  // Compute per-sector force weights (energy-conserving redistribution)
  const base = 1 / EXPLOSION_FORCE_RAY_COUNT;
  const totalRedirected = sectorBlockedness.reduce((sum, b) => sum + b, 0)
    * base * EXPLOSION_REDIRECT_EFFICIENCY;
  const totalOpenness = sectorBlockedness.reduce((sum, b) => sum + (1 - b), 0);

  const sectorWeight: number[] = new Array(EXPLOSION_FORCE_RAY_COUNT);
  for (let i = 0; i < EXPLOSION_FORCE_RAY_COUNT; i++) {
    const b = sectorBlockedness[i];
    sectorWeight[i] = base
      - b * base * EXPLOSION_REDIRECT_EFFICIENCY
      + (totalOpenness > 0 ? (1 - b) * totalRedirected / totalOpenness : 0);
  }

  // === FORCE PASS: shielded radial impulse with force redirection ===
  const sourceBodyHandle = comp.bodyHandle;

  for (const ship of sim.ships) {
    const body = sim.world.getRigidBody(ship.bodyHandle);
    if (!body) continue;
    for (const target of ship.components) {
      if (target === comp) continue;
      const tc = sim.world.getCollider(target.colliderHandle);
      if (!tc) continue;
      const tp = tc.translation();
      const dx = tp.x - pos.x;
      const dy = tp.y - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= forceRadius || dist < 0.01) continue;

      // Line-of-sight check (exclude exploding component's collider)
      const rayDir = { x: dx / dist, y: dy / dist };
      const losRay = new RAPIER.Ray({ x: pos.x, y: pos.y }, rayDir);
      const losHit = sim.world.castRay(losRay, dist, true,
        undefined, undefined, collider,
      );
      if (losHit && losHit.collider.handle !== tc.handle) continue; // shielded

      // Determine sector and apply redirection weight
      // Same-body: normal force (base). Cross-body: sector-weighted force.
      const angle = Math.atan2(dy, dx);
      const sectorIdx = ((Math.round(angle / (2 * Math.PI / EXPLOSION_FORCE_RAY_COUNT))
        % EXPLOSION_FORCE_RAY_COUNT) + EXPLOSION_FORCE_RAY_COUNT) % EXPLOSION_FORCE_RAY_COUNT;
      const weight = (target.bodyHandle === sourceBodyHandle)
        ? base
        : sectorWeight[sectorIdx];

      const falloff = Math.pow(1 - dist / forceRadius, 2);
      const str = EXPLOSION_FORCE_STRENGTH * chainMultiplier * falloff
        * weight * EXPLOSION_FORCE_RAY_COUNT;
      body.applyImpulseAtPoint(
        { x: (dx / dist) * str, y: (dy / dist) * str },
        { x: tp.x, y: tp.y },
        true,
      );
    }
  }

  // Chain reactions
  for (const { comp: chainComp, mult } of detonationQueue) {
    detonateExplosive(sim, chainComp, mult);
  }
}

/** Process auto-detonation of destroyed explosives and update visual explosions */
export function processExplosions(sim: BattleSimulation, dt: number) {
  // Check for destroyed explosives that need to auto-detonate
  for (const ship of sim.ships) {
    for (const comp of ship.components) {
      if (comp.type === ComponentType.Explosive && comp.health <= 0) {
        // Already handled by destruction - detonation happens when manually triggered
        // or via chain reaction. Auto-detonate is handled in processDestruction
      }
    }
  }

  // Update visual explosion ages
  for (let i = activeExplosions.length - 1; i >= 0; i--) {
    activeExplosions[i].age += dt;
    if (activeExplosions[i].age >= activeExplosions[i].maxAge) {
      activeExplosions.splice(i, 1);
    }
  }
}

/** Check if any explosive components were destroyed this frame and detonate them */
export function checkAutoDetonate(sim: BattleSimulation, previousHealth: Map<string, number>) {
  for (const ship of sim.ships) {
    for (const comp of ship.components) {
      if (comp.type !== ComponentType.Explosive) continue;
      const prevHP = previousHealth.get(comp.id) ?? comp.maxHealth;
      if (prevHP > 0 && comp.health <= 0) {
        detonateExplosive(sim, comp, 1);
      }
    }
  }
}
