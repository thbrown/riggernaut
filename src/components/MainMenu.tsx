import { useEffect, useRef } from 'react';
import { GamePhase } from '../types/game';
import { useGame } from '../state/GameContext';
import { randomizeCosts, computeInitialFunds } from '../game/cost-randomizer';
import './MainMenu.css';

/** Simple animated star field for the main menu background */
function useStarFieldCanvas(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    const stars: Array<{ x: number; y: number; size: number; speed: number; brightness: number }> = [];

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();

    // Generate stars
    for (let i = 0; i < 200; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 1.5 + 0.5,
        speed: Math.random() * 0.3 + 0.05,
        brightness: Math.random() * 0.6 + 0.3,
      });
    }

    function draw() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const star of stars) {
        // Drift slowly
        star.y += star.speed;
        if (star.y > canvas.height) {
          star.y = 0;
          star.x = Math.random() * canvas.width;
        }

        // Twinkle
        const twinkle = star.brightness + Math.sin(Date.now() * 0.001 + star.x) * 0.15;
        ctx.fillStyle = `rgba(200, 220, 255, ${Math.max(0, twinkle)})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    }

    draw();
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [canvasRef]);
}

export function MainMenu() {
  const { dispatch } = useGame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useStarFieldCanvas(canvasRef);

  const handleSinglePlayer = () => {
    const costs = randomizeCosts();
    const initialFunds = computeInitialFunds(costs);
    dispatch({ type: 'SET_COSTS', costs, initialFunds });
    dispatch({ type: 'SET_PHASE', phase: GamePhase.Build });
  };

  return (
    <div className="main-menu">
      <canvas ref={canvasRef} className="main-menu__bg" />
      <h1 className="main-menu__title">Riggernaut</h1>
      <div className="main-menu__buttons">
        <button className="main-menu__btn" onClick={handleSinglePlayer}>
          Single Player
        </button>
        <button className="main-menu__btn" disabled>
          Multiplayer Lobby
        </button>
        <button className="main-menu__btn" disabled>
          Tutorial
        </button>
        <button className="main-menu__btn" disabled>
          Replays
        </button>
        <button className="main-menu__btn" disabled>
          Library
        </button>
      </div>
    </div>
  );
}
