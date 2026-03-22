import { PlacedComponent } from '../types/grid';
import { ShipBlueprint } from '../types/physics';
import { computeAdjacency, computeAttachment } from './grid-logic';

/** Convert build-phase grid into a ShipBlueprint for the battle engine */
export function createBlueprint(allComponents: PlacedComponent[]): ShipBlueprint {
  // Only include components attached to a Command Module
  const { attached } = computeAttachment(allComponents);
  const shipComponents = allComponents.filter(c => attached.has(c.id));

  const adjacency = computeAdjacency(shipComponents);

  return {
    components: shipComponents.map(c => ({
      id: c.id,
      type: c.type,
      gridX: c.position.x,
      gridY: c.position.y,
      rotation: c.rotation,
      hotkey: c.hotkey,
      hotkeys: c.hotkeys,
      hotkeyPriority: c.hotkeyPriority,
      hotkeyPriorities: c.hotkeyPriorities,
      hingeStartAngle: c.hingeStartAngle,
      enabledSides: c.enabledSides,
    })),
    adjacency,
  };
}
