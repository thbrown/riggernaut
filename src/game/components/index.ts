import { ComponentDef, ComponentType } from '../../types/components';
import { CommandModuleDef } from './command-module';
import { EngineSmallDef, EngineMediumDef, EngineLargeDef } from './engines';
import { BlasterSmallDef, BlasterMediumDef, BlasterLargeDef } from './blasters';
import { DummyDef, ArmorDef, RamDef } from './structural';
import { DecouplerDef } from './decoupler';
import { ExplosiveDef } from './explosive';
import { RadioDef } from './radio';
import { Hinge90Def, Hinge180Def } from './hinges';

const COMPONENT_DEFS: ComponentDef[] = [
  CommandModuleDef,
  EngineSmallDef,
  EngineMediumDef,
  EngineLargeDef,
  DummyDef,
  ArmorDef,
  RamDef,
  BlasterSmallDef,
  BlasterMediumDef,
  BlasterLargeDef,
  DecouplerDef,
  ExplosiveDef,
  RadioDef,
  Hinge90Def,
  Hinge180Def,
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

// Re-export component defs for direct access
export {
  CommandModuleDef,
  EngineSmallDef, EngineMediumDef, EngineLargeDef,
  BlasterSmallDef, BlasterMediumDef, BlasterLargeDef,
  DummyDef, ArmorDef, RamDef,
  DecouplerDef,
  ExplosiveDef,
  RadioDef,
  Hinge90Def, Hinge180Def,
};

// Re-export hinge helpers
export { getHingeStartAngleRad } from './hinges';
