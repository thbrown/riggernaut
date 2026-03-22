import { BattleSimulation } from '../BattleSimulation';
import { processCollisionDamage } from './CollisionDamageSystem';
import { processExhaustDamage } from './ExhaustDamageSystem';
import { checkAutoDetonate, processExplosions } from './ExplosionSystem';
import { processDestruction } from './DestructionSystem';

/** Run the full post-physics damage sequence in correct order */
export function runDamagePhase(sim: BattleSimulation, prevHealth: Map<string, number>, dt: number, damageEvents: Array<[number, number, boolean]>) {
  // 1. Collision damage
  processCollisionDamage(sim, damageEvents);

  // 2. Exhaust damage
  processExhaustDamage(sim);

  // 3. Auto-detonate explosives destroyed this tick
  checkAutoDetonate(sim, prevHealth);

  // 4. Snapshot component counts before destruction for logging
  const compCountsBefore = new Map<number, number>();
  for (const ship of sim.ships) {
    compCountsBefore.set(ship.bodyHandle, ship.components.filter(c => c.health > 0).length);
  }

  // 5. Process destruction (remove dead components, detect disconnection, split orphans)
  processDestruction(sim);

  // 6. Log destruction events
  for (const ship of sim.ships) {
    const before = compCountsBefore.get(ship.bodyHandle) ?? 0;
    const after = ship.components.filter(c => c.health > 0).length;
    const destroyed = before - after;
    if (destroyed > 0) {
      sim.battleLog.logEvent(sim.tickCount, 'destruction', `${destroyed} component(s) destroyed`);
    }
  }

  // 7. Process visual explosions
  processExplosions(sim, dt);
}
