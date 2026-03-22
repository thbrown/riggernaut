import { BattleSimulation } from '../BattleSimulation';
import { getComponentDef } from '../../game/components';

/** Check win/loss conditions */
export function checkWinLoss(sim: BattleSimulation): void {
  if (sim.gameOver) return;

  const playerShip = sim.ships.find(s => s.isPlayer);
  const enemyShips = sim.ships.filter(s => !s.isPlayer);

  const playerAlive = playerShip
    ? playerShip.components.some(c => getComponentDef(c.type).isConnectivityAnchor && c.health > 0)
    : false;

  const anyEnemyAlive = enemyShips.some(ship =>
    ship.components.some(c => getComponentDef(c.type).isConnectivityAnchor && c.health > 0)
  );

  if (!playerAlive && !anyEnemyAlive) {
    sim.gameOver = true;
    sim.winner = 'draw';
    sim.camera.onPlayerDeath(sim);
  } else if (!playerAlive) {
    sim.gameOver = true;
    sim.winner = 'enemy';
    sim.camera.onPlayerDeath(sim);
  } else if (!anyEnemyAlive && enemyShips.length > 0) {
    sim.gameOver = true;
    sim.winner = 'player';
  }
}
