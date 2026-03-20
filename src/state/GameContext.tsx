import { createContext, useContext, useReducer, ReactNode } from 'react';
import { GamePhase, GameSettings, TeamMode } from '../types/game';
import { PlacedComponent, BuildGrid } from '../types/grid';
import { ShipBlueprint } from '../types/physics';
import { DEFAULT_BUILD_WIDTH, DEFAULT_BUILD_HEIGHT, SANDBOX_FUNDS } from '../config/constants';

export interface GameState {
  phase: GamePhase;
  settings: GameSettings;
  costs: Record<string, number>;
  buildGrid: BuildGrid;
  blueprint: ShipBlueprint | null;
  sandbox: boolean;
}

const initialState: GameState = {
  phase: GamePhase.MainMenu,
  settings: {
    teamMode: TeamMode.FFA,
    initialFunds: 20,
    buildWidth: DEFAULT_BUILD_WIDTH,
    buildHeight: DEFAULT_BUILD_HEIGHT,
    buildTimerSeconds: null,
  },
  costs: {},
  buildGrid: {
    width: DEFAULT_BUILD_WIDTH,
    height: DEFAULT_BUILD_HEIGHT,
    components: [],
  },
  blueprint: null,
  sandbox: false,
};

export type GameAction =
  | { type: 'SET_PHASE'; phase: GamePhase }
  | { type: 'SET_COSTS'; costs: Record<string, number>; initialFunds: number }
  | { type: 'SET_BUILD_COMPONENTS'; components: PlacedComponent[] }
  | { type: 'SET_BLUEPRINT'; blueprint: ShipBlueprint }
  | { type: 'TOGGLE_SANDBOX' }
  | { type: 'RESET_GAME' };

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'SET_PHASE':
      return { ...state, phase: action.phase };
    case 'SET_COSTS':
      return {
        ...state,
        costs: action.costs,
        settings: { ...state.settings, initialFunds: action.initialFunds },
      };
    case 'SET_BUILD_COMPONENTS':
      return {
        ...state,
        buildGrid: { ...state.buildGrid, components: action.components },
      };
    case 'SET_BLUEPRINT':
      return { ...state, blueprint: action.blueprint };
    case 'TOGGLE_SANDBOX': {
      const nowSandbox = !state.sandbox;
      return {
        ...state,
        sandbox: nowSandbox,
        settings: {
          ...state.settings,
          initialFunds: nowSandbox ? SANDBOX_FUNDS : state.settings.initialFunds,
        },
      };
    }
    case 'RESET_GAME':
      return { ...initialState };
    default:
      return state;
  }
}

const GameContext = createContext<{
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
} | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  return (
    <GameContext.Provider value={{ state, dispatch }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within GameProvider');
  return ctx;
}
