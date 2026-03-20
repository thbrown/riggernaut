export enum GamePhase {
  MainMenu = 'main_menu',
  Build = 'build',
  HotkeyAssignment = 'hotkey_assignment',
  OpponentSelection = 'opponent_selection',
  Battle = 'battle',
  Summary = 'summary',
}

export enum TeamMode {
  FFA = 'ffa',
  Custom = 'custom',
}

export interface PlayerConfig {
  color: string;
  shape: string;
  team: number;
}

export interface GameSettings {
  teamMode: TeamMode;
  initialFunds: number;
  buildWidth: number;
  buildHeight: number;
  buildTimerSeconds: number | null; // null = unlimited
}

export interface CostTable {
  costs: Record<string, number>;
}
