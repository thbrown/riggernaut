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

export interface ComponentDef {
  type: ComponentType;
  displayName: string;
  hardness: number;
  mass: number;
  maxHealth: number;
  attachableSides: Side[];
  hasPower: boolean;
  /** Which side emits thrust/fires bolts/has the pointed end (non-attachable functional side) */
  functionalSide?: Side;
}
