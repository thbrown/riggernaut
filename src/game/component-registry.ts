import { ComponentDef, ComponentType, Side, ALL_SIDES } from '../types/components';

const threeSides = (excluded: Side): Side[] => ALL_SIDES.filter(s => s !== excluded);
const twoSides = (a: Side, b: Side): Side[] => [a, b];

const COMPONENT_DEFS: ComponentDef[] = [
  {
    type: ComponentType.CommandModule,
    displayName: 'Command Module',
    hardness: 2,
    mass: 100,
    maxHealth: 100,
    attachableSides: [...ALL_SIDES],
    hasPower: false,
  },
  {
    type: ComponentType.EngineSmall,
    displayName: 'Engine (S)',
    hardness: 0.5,
    mass: 100,
    maxHealth: 50,
    attachableSides: threeSides(Side.South),
    hasPower: true,
    functionalSide: Side.South,
  },
  {
    type: ComponentType.EngineMedium,
    displayName: 'Engine (M)',
    hardness: 0.5,
    mass: 100,
    maxHealth: 50,
    attachableSides: threeSides(Side.South),
    hasPower: true,
    functionalSide: Side.South,
  },
  {
    type: ComponentType.EngineLarge,
    displayName: 'Engine (L)',
    hardness: 0.5,
    mass: 100,
    maxHealth: 50,
    attachableSides: threeSides(Side.South),
    hasPower: true,
    functionalSide: Side.South,
  },
  {
    type: ComponentType.Dummy,
    displayName: 'Dummy',
    hardness: 1,
    mass: 100,
    maxHealth: 100,
    attachableSides: [...ALL_SIDES],
    hasPower: false,
  },
  {
    type: ComponentType.Armor,
    displayName: 'Armor',
    hardness: 5,
    mass: 100,
    maxHealth: 200,
    attachableSides: [...ALL_SIDES],
    hasPower: false,
  },
  {
    type: ComponentType.Ram,
    displayName: 'Ram',
    hardness: 10,
    mass: 100,
    maxHealth: 100,
    attachableSides: threeSides(Side.North),
    hasPower: false,
    functionalSide: Side.North,
  },
  {
    type: ComponentType.BlasterSmall,
    displayName: 'Blaster (S)',
    hardness: 0.5,
    mass: 100,
    maxHealth: 50,
    attachableSides: threeSides(Side.North),
    hasPower: true,
    functionalSide: Side.North,
  },
  {
    type: ComponentType.BlasterMedium,
    displayName: 'Blaster (M)',
    hardness: 0.5,
    mass: 100,
    maxHealth: 50,
    attachableSides: threeSides(Side.North),
    hasPower: true,
    functionalSide: Side.North,
  },
  {
    type: ComponentType.BlasterLarge,
    displayName: 'Blaster (L)',
    hardness: 0.5,
    mass: 100,
    maxHealth: 50,
    attachableSides: threeSides(Side.North),
    hasPower: true,
    functionalSide: Side.North,
  },
  {
    type: ComponentType.Decoupler,
    displayName: '(De)coupler',
    hardness: 0.5,
    mass: 100,
    maxHealth: 50,
    attachableSides: [...ALL_SIDES],
    hasPower: true,
  },
  {
    type: ComponentType.Explosive,
    displayName: 'Explosive',
    hardness: 1,
    mass: 100,
    maxHealth: 25,
    attachableSides: [...ALL_SIDES],
    hasPower: true,
  },
  {
    type: ComponentType.Radio,
    displayName: 'Radio',
    hardness: 1,
    mass: 100,
    maxHealth: 100,
    attachableSides: [...ALL_SIDES],
    hasPower: false,
  },
  {
    type: ComponentType.Hinge90,
    displayName: 'Hinge (90°)',
    hardness: 0.5,
    mass: 100,
    maxHealth: 50,
    attachableSides: twoSides(Side.East, Side.West),
    hasPower: true,
  },
  {
    type: ComponentType.Hinge180,
    displayName: 'Hinge (180°)',
    hardness: 0.5,
    mass: 100,
    maxHealth: 50,
    attachableSides: twoSides(Side.East, Side.West),
    hasPower: true,
  },
];

export const COMPONENT_REGISTRY = new Map<ComponentType, ComponentDef>(
  COMPONENT_DEFS.map(def => [def.type, def])
);

export function getComponentDef(type: ComponentType): ComponentDef {
  const def = COMPONENT_REGISTRY.get(type);
  if (!def) throw new Error(`Unknown component type: ${type}`);
  return def;
}

export const ALL_COMPONENT_TYPES = COMPONENT_DEFS.map(d => d.type);
