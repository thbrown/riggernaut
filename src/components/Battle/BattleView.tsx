import { useEffect, useRef, useCallback, useState } from 'react';
import { GamePhase } from '../../types/game';
import { useGame } from '../../state/GameContext';
import { initRapier } from '../../engine/rapier-init';
import { BattleSimulation } from '../../engine/BattleSimulation';
import { BattleRenderer } from '../../engine/BattleRenderer';
import { GameLoop } from '../../engine/GameLoop';
import { InputManager } from '../../engine/InputManager';
import { createRammerBlueprint, createShooterBlueprint } from '../../game/ai-prefabs';
import { OpponentConfig } from '../OpponentSelection/OpponentSelection';
import { clearParticles } from '../../engine/ParticleSystem';
import { clearExplosions } from '../../engine/systems/ExplosionSystem';
import { resetProjectileId } from '../../engine/entities/Projectile';
import { clearCooldowns } from '../../engine/systems/ProjectileSystem';
import './BattleView.css';

export function BattleView() {
  const { state, dispatch } = useGame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<BattleSimulation | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const [gameResult, setGameResult] = useState<string | null>(null);

  const handleEndBattle = useCallback(() => {
    dispatch({ type: 'SET_PHASE', phase: GamePhase.Summary });
  }, [dispatch]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let destroyed = false;
    let handleResize: (() => void) | null = null;
    let handleWheel: ((e: WheelEvent) => void) | null = null;
    let handleKeyDown: ((e: KeyboardEvent) => void) | null = null;

    async function startBattle() {
      await initRapier();
      if (destroyed || !canvas) return;

      // Clear stale module-level state from previous battles
      clearParticles();
      clearExplosions();
      resetProjectileId();
      clearCooldowns();

      const input = new InputManager();
      input.attach();
      inputRef.current = input;

      const sim = new BattleSimulation(input);

      // Read opponent config
      let opponentConfig: OpponentConfig = { rammers: 1, shooters: 0 };
      try {
        const stored = sessionStorage.getItem('opponentConfig');
        if (stored) opponentConfig = JSON.parse(stored);
      } catch { /* use defaults */ }

      // Build enemy list
      const enemies: Array<{ blueprint: any; aiType: 'rammer' | 'shooter' }> = [];
      for (let i = 0; i < opponentConfig.rammers; i++) {
        enemies.push({ blueprint: createRammerBlueprint(), aiType: 'rammer' });
      }
      for (let i = 0; i < opponentConfig.shooters; i++) {
        enemies.push({ blueprint: createShooterBlueprint(), aiType: 'shooter' });
      }

      if (state.blueprint) {
        sim.init(state.blueprint, enemies);
      }

      simRef.current = sim;

      const renderer = new BattleRenderer(canvas);

      const loop = new GameLoop(
        (dt) => {
          sim.tick(dt);
          if (sim.gameOver && !gameResult) {
            const result = sim.winner === 'player' ? 'Victory!'
              : sim.winner === 'enemy' ? 'Defeat!'
              : 'Draw!';
            // Save stats for summary screen
            const stats = sim.battleLog.getStats();
            sessionStorage.setItem('battleStats', JSON.stringify({ result, ...stats }));
            setGameResult(result);
          }
        },
        (alpha) => {
          renderer.render(sim, alpha);
          renderer.renderHUD(sim);
          renderer.renderCountdown(sim);
        },
      );
      loopRef.current = loop;

      handleResize = () => renderer.resize();
      window.addEventListener('resize', handleResize);

      handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        renderer.adjustZoom(Math.sign(e.deltaY));
      };
      canvas.addEventListener('wheel', handleWheel, { passive: false });

      handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === '=' || e.key === '+') renderer.zoomIn();
        if (e.key === '-') renderer.zoomOut();
      };
      window.addEventListener('keydown', handleKeyDown);

      loop.start();
    }

    startBattle();

    return () => {
      destroyed = true;
      loopRef.current?.stop();
      inputRef.current?.detach();
      simRef.current?.destroy();
      if (handleResize) window.removeEventListener('resize', handleResize);
      if (handleWheel) canvas.removeEventListener('wheel', handleWheel);
      if (handleKeyDown) window.removeEventListener('keydown', handleKeyDown);
    };
  }, [state.blueprint]);

  return (
    <div className="battle-view">
      <canvas ref={canvasRef} className="battle-view__canvas" />
      <button className="battle-view__exit" onClick={handleEndBattle}>
        End Battle (ESC)
      </button>
      {gameResult && (
        <div className="battle-view__result">
          <h2>{gameResult}</h2>
          <button onClick={handleEndBattle}>Continue</button>
        </div>
      )}
    </div>
  );
}
