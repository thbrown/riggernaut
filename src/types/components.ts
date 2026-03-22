import type { ComponentInstance } from '../engine/entities/ComponentInstance';
import type { BattleSimulation, ShipState } from '../engine/BattleSimulation';
import type React from 'react';

export enum ComponentType {
  CommandModule = 'command_module',
  EngineSmall = 'engine_small',
  EngineMedium = 'engine_medium',
  EngineLarge = 'engine_large',
  Dummy = 'dummy',
  Armor = 'armor',
  Ram = 'ram',
  BlasterSmall = 'blaster_small',
  BlasterMedium = 'blaster_medium',
  BlasterLarge = 'blaster_large',
  Decoupler = 'decoupler',
  Explosive = 'explosive',
  Radio = 'radio',
  Hinge90 = 'hinge_90',
  Hinge180 = 'hinge_180',
}

export enum Side {
  North = 'north',
  South = 'south',
  East = 'east',
  West = 'west',
}

export const ALL_SIDES: Side[] = [Side.North, Side.South, Side.East, Side.West];

// === Type-specific configuration (discriminated union) ===

export interface EngineConfig {
  kind: 'engine';
  thrust: number;
  exhaustShape: { semiMajor: number; semiMinor: number };
  exhaustDps: number;
  nozzleScale: number;
}

export interface BlasterConfig {
  kind: 'blaster';
  boltSpeed: number;
  damage: number;
  fireRatePerSec: number;
  kickback: number;
  boltLength: number;
  boltWidth: number;
  boltColor: string;
}

export interface ExplosiveConfig {
  kind: 'explosive';
  detonationFuse: number; // ticks (60 = 1 second)
}

export interface HingeConfig {
  kind: 'hinge';
  maxAngle: number;
  startAngleSteps: number;
}

export interface DecouplerConfig {
  kind: 'decoupler';
}

export interface PassiveConfig {
  kind: 'passive';
}

export type ComponentConfig =
  | EngineConfig | BlasterConfig | ExplosiveConfig
  | HingeConfig | DecouplerConfig | PassiveConfig;

// === ComponentDef ===

export interface ComponentDef {
  // Identity & display
  type: ComponentType;
  displayName: string;
  color: string;

  // Physics & structure
  hardness: number;
  mass: number;
  maxHealth: number;
  attachableSides: Side[];
  colliderShape: 'square' | 'circle';
  functionalSide?: Side;

  // Activation
  hasPower: boolean;
  activationMode: 'hold' | 'press' | 'none';
  hotkeyLayout: 'single' | 'dual' | 'quad';

  // Role flags
  isConnectivityAnchor?: boolean;
  enablesDroneControl?: boolean;
  chainReactsOnDeath?: boolean;

  // Type-specific configuration
  config: ComponentConfig;

  // === Behavior callbacks ===
  getAttachableSides?: (comp: ComponentInstance) => Side[];
  onTickActive?: (sim: BattleSimulation, comp: ComponentInstance, ship: ShipState) => void;
  onHotkeyPressed?: (sim: BattleSimulation, comp: ComponentInstance, ship: ShipState, key: string) => void;
  onDestroyed?: (sim: BattleSimulation, comp: ComponentInstance) => void;

  // === Rendering callbacks ===
  drawDecoration?: (ctx: CanvasRenderingContext2D, halfSize: number, comp: ComponentInstance) => void;
  drawEffect?: (ctx: CanvasRenderingContext2D, halfSize: number, comp: ComponentInstance, sim: BattleSimulation) => void;
  drawHotkeyLabel?: (ctx: CanvasRenderingContext2D, halfSize: number, comp: ComponentInstance) => void;
  renderBuildDecoration?: (size: number, pad: number, inner: number, hingeStartAngle?: number) => React.ReactNode;
}
