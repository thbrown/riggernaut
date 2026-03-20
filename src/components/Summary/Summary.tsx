import { GamePhase } from '../../types/game';
import { useGame } from '../../state/GameContext';
import './Summary.css';

export function Summary() {
  const { dispatch } = useGame();

  // Read battle stats from sessionStorage (written by BattleView on end)
  let stats = {
    result: 'Unknown',
    durationSeconds: 0,
    avgAPM: 0,
    totalDamageEvents: 0,
    totalKills: 0,
    totalExplosions: 0,
    totalInputs: 0,
  };
  try {
    const stored = sessionStorage.getItem('battleStats');
    if (stored) stats = JSON.parse(stored);
  } catch { /* defaults */ }

  return (
    <div className="summary">
      <h2 className="summary__result">{stats.result}</h2>

      <div className="summary__stats">
        <div className="summary__stat">
          <span className="summary__stat-label">Duration</span>
          <span className="summary__stat-value">{stats.durationSeconds}s</span>
        </div>
        <div className="summary__stat">
          <span className="summary__stat-label">Avg APM</span>
          <span className="summary__stat-value">{stats.avgAPM}</span>
        </div>
        <div className="summary__stat">
          <span className="summary__stat-label">Total Inputs</span>
          <span className="summary__stat-value">{stats.totalInputs}</span>
        </div>
        <div className="summary__stat">
          <span className="summary__stat-label">Damage Events</span>
          <span className="summary__stat-value">{stats.totalDamageEvents}</span>
        </div>
        <div className="summary__stat">
          <span className="summary__stat-label">Kills</span>
          <span className="summary__stat-value">{stats.totalKills}</span>
        </div>
        <div className="summary__stat">
          <span className="summary__stat-label">Explosions</span>
          <span className="summary__stat-value">{stats.totalExplosions}</span>
        </div>
      </div>

      <div className="summary__actions">
        <button onClick={() => dispatch({ type: 'SET_PHASE', phase: GamePhase.Build })}>
          Return to Build
        </button>
        <button onClick={() => dispatch({ type: 'SET_PHASE', phase: GamePhase.OpponentSelection })}
          className="summary__quick-start"
        >
          Quick Start
        </button>
        <button onClick={() => dispatch({ type: 'SET_PHASE', phase: GamePhase.MainMenu })}>
          Main Menu
        </button>
      </div>
    </div>
  );
}
