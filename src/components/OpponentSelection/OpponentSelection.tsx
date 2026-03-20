import { useState, useCallback } from 'react';
import { GamePhase } from '../../types/game';
import { useGame } from '../../state/GameContext';
import { PhaseNav } from '../PhaseNav';
import './OpponentSelection.css';

export interface OpponentConfig {
  rammers: number;
  shooters: number;
}

export function OpponentSelection() {
  const { dispatch } = useGame();
  const [rammers, setRammers] = useState(1);
  const [shooters, setShooters] = useState(0);

  const handleProceed = useCallback(() => {
    // Store opponent config in sessionStorage for BattleView to read
    sessionStorage.setItem('opponentConfig', JSON.stringify({ rammers, shooters }));
    dispatch({ type: 'SET_PHASE', phase: GamePhase.Battle });
  }, [rammers, shooters, dispatch]);

  const handleBack = useCallback(() => {
    dispatch({ type: 'SET_PHASE', phase: GamePhase.HotkeyAssignment });
  }, [dispatch]);

  const total = rammers + shooters;

  return (
    <div className="opponent-select">
      <h2 className="opponent-select__title">Select Opponents</h2>
      <div className="opponent-select__grid">
        <div className="opponent-select__card">
          <h3>Rammer</h3>
          <p className="opponent-select__desc">
            Charges straight at you with rams and engines. High impact damage.
          </p>
          <div className="opponent-select__counter">
            <button onClick={() => setRammers(Math.max(0, rammers - 1))}>-</button>
            <span>{rammers}</span>
            <button onClick={() => setRammers(rammers + 1)}>+</button>
          </div>
        </div>
        <div className="opponent-select__card">
          <h3>Shooter</h3>
          <p className="opponent-select__desc">
            Keeps distance and fires blasters. Nimble with retrograde engine.
          </p>
          <div className="opponent-select__counter">
            <button onClick={() => setShooters(Math.max(0, shooters - 1))}>-</button>
            <span>{shooters}</span>
            <button onClick={() => setShooters(shooters + 1)}>+</button>
          </div>
        </div>
      </div>
      <PhaseNav
        onBack={handleBack}
        onNext={handleProceed}
        nextLabel={`Enter Battle (${total} opponent${total !== 1 ? 's' : ''})`}
        nextDisabled={total === 0}
      />
    </div>
  );
}
