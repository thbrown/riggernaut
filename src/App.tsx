import { useEffect, useState } from 'react';
import { GamePhase } from './types/game';
import { useGame } from './state/GameContext';
import { initRapier } from './engine/rapier-init';
import { MainMenu } from './components/MainMenu';
import { BuildPhase } from './components/BuildPhase/BuildPhase';
import { HotkeyAssignment } from './components/HotkeyAssignment/HotkeyAssignment';
import { OpponentSelection } from './components/OpponentSelection/OpponentSelection';
import { BattleView } from './components/Battle/BattleView';
import { Summary } from './components/Summary/Summary';

function App() {
  const { state } = useGame();
  const [rapierReady, setRapierReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initRapier()
      .then(() => setRapierReady(true))
      .catch(err => setError(`Failed to initialize physics engine: ${err.message}`));
  }, []);

  if (error) {
    return <div style={{ color: '#ff4444', padding: '2rem' }}>{error}</div>;
  }

  if (!rapierReady) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#88ccff', background: '#0a0a1a' }}>
        Loading physics engine...
      </div>
    );
  }

  switch (state.phase) {
    case GamePhase.MainMenu:
      return <MainMenu />;
    case GamePhase.Build:
      return <BuildPhase />;
    case GamePhase.HotkeyAssignment:
      return <HotkeyAssignment />;
    case GamePhase.OpponentSelection:
      return <OpponentSelection />;
    case GamePhase.Battle:
      return <BattleView />;
    case GamePhase.Summary:
      return <Summary />;
    default:
      return <MainMenu />;
  }
}

export default App;
