import { ShipState } from '../BattleSimulation';
import { ComponentType } from '../../types/components';

/** Check if a ship is a drone (has Radio, no Command Module) */
export function isDrone(ship: ShipState): boolean {
  const hasRadio = ship.components.some(c => c.type === ComponentType.Radio && c.health > 0);
  const hasCmd = ship.components.some(c => c.type === ComponentType.CommandModule && c.health > 0);
  return hasRadio && !hasCmd;
}
