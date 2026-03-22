import { ComponentType } from '../types/components';
import { COST_MIN, COST_MAX } from '../config/constants';
import { ALL_COMPONENT_TYPES } from './components';

/** Components whose costs must be linearly increasing with size */
const LINEAR_GROUPS: ComponentType[][] = [
  [ComponentType.EngineSmall, ComponentType.EngineMedium, ComponentType.EngineLarge],
  [ComponentType.BlasterSmall, ComponentType.BlasterMedium, ComponentType.BlasterLarge],
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomizeCosts(): Record<string, number> {
  const costs: Record<string, number> = {};

  // Assign costs for linearly-constrained groups first
  const grouped = new Set<ComponentType>();
  for (const group of LINEAR_GROUPS) {
    // Pick a start (1..COST_MAX-2) and ensure room for increasing values
    const maxStart = COST_MAX - (group.length - 1);
    const start = randomInt(COST_MIN, Math.max(COST_MIN, maxStart));
    const maxSlope = Math.floor((COST_MAX - start) / Math.max(1, group.length - 1));
    const slope = randomInt(1, Math.max(1, maxSlope));

    for (let i = 0; i < group.length; i++) {
      costs[group[i]] = Math.min(start + slope * i, COST_MAX);
      grouped.add(group[i]);
    }
  }

  // Assign random costs to remaining components
  for (const type of ALL_COMPONENT_TYPES) {
    if (!grouped.has(type)) {
      costs[type] = randomInt(COST_MIN, COST_MAX);
    }
  }

  return costs;
}

export function computeInitialFunds(costs: Record<string, number>): number {
  const maxCost = Math.max(...Object.values(costs));
  return maxCost * 2;
}
