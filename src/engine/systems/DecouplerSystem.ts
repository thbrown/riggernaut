import RAPIER from '@dimforge/rapier2d-compat';
import { BattleSimulation, ShipState } from '../BattleSimulation';
import { ComponentInstance } from '../entities/ComponentInstance';
import { ComponentType, Side } from '../../types/components';
import { rotateSide } from '../../types/grid';
import {
  DECOUPLER_DETACH_IMPULSE, FIXED_TIMESTEP,
  DECOUPLER_ATTRACTION_RADIUS,
  DECOUPLER_ATTRACTION_FORCE, DECOUPLER_DOCK_MAX_SPEED, TILE_SIZE,
} from '../../config/constants';
import { getComponentDef } from '../../game/component-registry';
import { splitOrphansToNewBodies } from './DamageSystem';
import { isDrone } from './RadioSystem';

export type DecouplerMode = 'latched' | 'unlatched' | 'attractor';

export interface DecouplerSideState {
  /** The rotated (world-facing) side — used for grid neighbor lookup */
  side: Side;
  /** The base (pre-rotation) side — used for rendering in component-local space */
  baseSide: Side;
  hotkey?: string;
  mode: DecouplerMode;
}

export interface DecouplerState {
  compId: string;
  bodyHandle: number;
  sides: DecouplerSideState[];
}

/**
 * Build per-side state for a decoupler.
 * UI stores: slot 0 → comp.hotkey (North), slot 1 → comp.hotkeys[0] (East),
 * slot 2 → comp.hotkeys[1] (South), slot 3 → comp.hotkeys[2] (West).
 */
export function buildDecouplerSides(
  rotation: number,
  hotkeys?: string[],
  hotkey?: string,
): DecouplerSideState[] {
  const baseSides: Side[] = [Side.North, Side.East, Side.South, Side.West];
  return baseSides.map((baseSide, i) => {
    const rotatedSide = rotateSide(baseSide, rotation);
    // Match the UI storage: index 0 = hotkey, index 1+ = hotkeys[i-1]
    const hk = i === 0 ? hotkey : hotkeys?.[i - 1];
    return {
      side: rotatedSide,
      baseSide,
      hotkey: hk,
      mode: 'latched' as DecouplerMode,
    };
  });
}

/** Process decoupler hotkey presses — cycles: latched → unlatched → attractor → unlatched → ... */
export function processDecouplerInput(
  sim: BattleSimulation,
  pressedKeys: Set<string>,
  decouplers: DecouplerState[],
) {
  for (const dc of decouplers) {
    for (const sideState of dc.sides) {
      if (!sideState.hotkey || !pressedKeys.has(sideState.hotkey)) continue;

      if (sideState.mode === 'latched') {
        detachDecoupler(sim, dc, sideState);
      } else if (sideState.mode === 'unlatched') {
        sideState.mode = 'attractor';
      } else {
        sideState.mode = 'unlatched';
      }
    }
  }
}

/** Grid offset for a given side */
function sideOffset(side: Side): { dx: number; dy: number } {
  switch (side) {
    case Side.North: return { dx: 0, dy: -1 };
    case Side.South: return { dx: 0, dy: 1 };
    case Side.East: return { dx: 1, dy: 0 };
    case Side.West: return { dx: -1, dy: 0 };
  }
}

function detachDecoupler(sim: BattleSimulation, dc: DecouplerState, sideState: DecouplerSideState) {
  let ship: ShipState | undefined;
  let comp: ComponentInstance | undefined;

  for (const s of sim.ships) {
    const c = s.components.find(c => c.id === dc.compId);
    if (c) { ship = s; comp = c; break; }
  }

  if (!ship || !comp) return;

  const body = sim.world.getRigidBody(ship.bodyHandle);
  if (!body) return;

  // Find the neighbor on the detaching side (uses rotated side for grid lookup)
  const offset = sideOffset(sideState.side);
  const neighborX = comp.gridX + offset.dx;
  const neighborY = comp.gridY + offset.dy;

  const neighbor = ship.components.find(
    c => c.gridX === neighborX && c.gridY === neighborY && c.health > 0
  );

  if (!neighbor) {
    sideState.mode = 'unlatched';
    return;
  }

  // BFS from Command Module, treating the decoupler↔neighbor link as severed
  const severedLink = new Set([
    `${dc.compId}:${neighbor.id}`,
    `${neighbor.id}:${dc.compId}`,
  ]);

  const adj = new Map<string, string[]>();
  for (const c of ship.components) {
    adj.set(c.id, []);
  }
  for (let i = 0; i < ship.components.length; i++) {
    for (let j = i + 1; j < ship.components.length; j++) {
      const a = ship.components[i];
      const b = ship.components[j];
      const dx = Math.abs(a.gridX - b.gridX);
      const dy = Math.abs(a.gridY - b.gridY);
      if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) {
        const linkKey = `${a.id}:${b.id}`;
        const linkKeyRev = `${b.id}:${a.id}`;
        if (!severedLink.has(linkKey) && !severedLink.has(linkKeyRev)) {
          adj.get(a.id)!.push(b.id);
          adj.get(b.id)!.push(a.id);
        }
      }
    }
  }

  const visited = new Set<string>();
  const queue: string[] = [];
  for (const c of ship.components) {
    if (c.type === ComponentType.CommandModule) {
      visited.add(c.id);
      queue.push(c.id);
    }
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const neighborId of adj.get(id) ?? []) {
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push(neighborId);
      }
    }
  }

  const orphans = ship.components.filter(c => !visited.has(c.id));

  if (orphans.length > 0) {
    ship.components = ship.components.filter(c => visited.has(c.id));
    splitOrphansToNewBodies(sim, ship, orphans, adj);

    // Set owner on orphaned components:
    // - Space junk (no Radio) → owner = null (freezes current isActive)
    // - Drones (has Radio) → keep owner as-is (player can still control)
    for (const s of sim.ships) {
      if (orphans.some(o => s.components.includes(o)) && !isDrone(s)) {
        for (const orphan of s.components) {
          orphan.owner = null;
        }
      }
    }

    const angle = body.rotation();
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dirX = offset.dx;
    const dirY = offset.dy;
    const worldDirX = dirX * cos - dirY * sin;
    const worldDirY = dirX * sin + dirY * cos;

    // Apply at the decoupler's world position for proper torque
    const dcCollider = sim.world.getCollider(comp!.colliderHandle);
    const dcWorldPos = dcCollider ? dcCollider.translation() : body.translation();

    body.applyImpulseAtPoint(
      { x: -worldDirX * DECOUPLER_DETACH_IMPULSE, y: -worldDirY * DECOUPLER_DETACH_IMPULSE },
      dcWorldPos,
      true,
    );

    for (const s of sim.ships) {
      if (s === ship) continue;
      if (orphans.some(o => s.components.includes(o))) {
        const orphanBody = sim.world.getRigidBody(s.bodyHandle);
        if (orphanBody) {
          orphanBody.applyImpulseAtPoint(
            { x: worldDirX * DECOUPLER_DETACH_IMPULSE, y: worldDirY * DECOUPLER_DETACH_IMPULSE },
            dcWorldPos,
            true,
          );
        }
      }
    }
  }

  sideState.mode = 'unlatched';
  dc.bodyHandle = comp.bodyHandle;
}

/** Compute the world-space direction and dock point for a given attractor side */
function getAttractorSideWorld(
  dcPos: { x: number; y: number },
  bodyAngle: number,
  side: Side,
): { dirX: number; dirY: number; dockX: number; dockY: number } {
  const offset = sideOffset(side);
  const cos = Math.cos(bodyAngle);
  const sin = Math.sin(bodyAngle);
  const dirX = offset.dx * cos - offset.dy * sin;
  const dirY = offset.dx * sin + offset.dy * cos;
  return {
    dirX, dirY,
    dockX: dcPos.x + dirX * TILE_SIZE,
    dockY: dcPos.y + dirY * TILE_SIZE,
  };
}

/** Alignment tolerance for docking (fraction of TILE_SIZE) */
const DOCK_ALIGN_TOLERANCE = 0.02 * TILE_SIZE;
/** Lateral correction force scale */
const DOCK_ALIGN_FORCE = 150;
/** PD controller: damping along attraction axis */
const ATTRACTION_DAMPING = 12;
/** PD controller: damping perpendicular to attraction axis */
const LATERAL_DAMPING = 10;
/** Max approach speed (tiles/s) — above this only damping is applied */
const MAX_APPROACH_SPEED = 2.0;

/** Apply attractive force from attractor-mode decouplers, only past the enabled edge */
export function processDecouplerAttraction(sim: BattleSimulation, decouplers: DecouplerState[]) {
  for (const dc of decouplers) {
    const attractorSides = dc.sides.filter(s => s.mode === 'attractor');
    if (attractorSides.length === 0) continue;

    let comp: ComponentInstance | undefined;
    for (const s of sim.ships) {
      comp = s.components.find(c => c.id === dc.compId);
      if (comp) break;
    }
    if (!comp || comp.health <= 0) continue;

    const collider = sim.world.getCollider(comp.colliderHandle);
    if (!collider) continue;
    const dcPos = collider.translation();
    const dcBody = sim.world.getRigidBody(comp.bodyHandle);
    if (!dcBody) continue;
    const dcBodyHandle = dcBody.handle;
    const dcAngle = dcBody.rotation();

    // Per-side attraction: only pull bodies on the correct side of the decoupler
    for (const sideState of attractorSides) {
      const { dirX, dirY, dockX, dockY } = getAttractorSideWorld(dcPos, dcAngle, sideState.side);

      for (const ship of sim.ships) {
        const shipBody = sim.world.getRigidBody(ship.bodyHandle);
        if (!shipBody || shipBody.handle === dcBodyHandle) continue;

        // Check each component on this ship for proximity
        for (const otherComp of ship.components) {
          if (otherComp.health <= 0) continue;
          const otherColl = sim.world.getCollider(otherComp.colliderHandle);
          if (!otherColl) continue;
          const otherPos = otherColl.translation();

          // Vector from decoupler to the other component
          const toCompX = otherPos.x - dcPos.x;
          const toCompY = otherPos.y - dcPos.y;

          // Dot product: positive means the component is on the correct side
          const dot = toCompX * dirX + toCompY * dirY;
          if (dot < 0) continue; // Behind the decoupler face — skip

          // Distance from the dock point (where the attracted comp should end up)
          const toDockX = dockX - otherPos.x;
          const toDockY = dockY - otherPos.y;
          const dist = Math.sqrt(toDockX * toDockX + toDockY * toDockY);

          if (dist > DECOUPLER_ATTRACTION_RADIUS || dist < 0.01) continue;

          // Relative velocity between attracted body and decoupler body
          const dcVel = dcBody.linvel();
          const shipVel = shipBody.linvel();
          const relVx = shipVel.x - dcVel.x;
          const relVy = shipVel.y - dcVel.y;

          // Decompose relative velocity: along attraction axis and perpendicular
          const approachSpeed = -(relVx * dirX + relVy * dirY); // positive = closing
          const lateralVel = relVx * (-dirY) + relVy * dirX; // perpendicular component

          // P term: pull toward dock point (skip if already approaching too fast)
          let fx = 0;
          let fy = 0;
          if (approachSpeed < MAX_APPROACH_SPEED) {
            const falloff = 1 - dist / DECOUPLER_ATTRACTION_RADIUS;
            const forceMag = DECOUPLER_ATTRACTION_FORCE * falloff;
            fx = (toDockX / dist) * forceMag * FIXED_TIMESTEP;
            fy = (toDockY / dist) * forceMag * FIXED_TIMESTEP;
          }

          // D term: damp relative velocity along attraction axis
          fx += -relVx * dirX * dirX * ATTRACTION_DAMPING * FIXED_TIMESTEP;
          fy += -relVy * dirY * dirY * ATTRACTION_DAMPING * FIXED_TIMESTEP;
          // Cross terms for axis-aligned damping
          fx += -relVx * dirY * dirY * LATERAL_DAMPING * FIXED_TIMESTEP;
          fy += -relVy * dirX * dirX * LATERAL_DAMPING * FIXED_TIMESTEP;

          shipBody.applyImpulseAtPoint({ x: fx, y: fy }, otherPos, true);
          dcBody.applyImpulseAtPoint({ x: -fx, y: -fy }, dcPos, true);

          // Lateral alignment correction with damping
          const lateralOffset = (otherPos.x - dockX) * (-dirY) + (otherPos.y - dockY) * dirX;
          if (Math.abs(lateralOffset) > 0.01) {
            // P term: push toward alignment
            const corrX = -(-dirY) * lateralOffset * DOCK_ALIGN_FORCE * FIXED_TIMESTEP;
            const corrY = -(dirX) * lateralOffset * DOCK_ALIGN_FORCE * FIXED_TIMESTEP;
            // D term: damp lateral velocity
            const latDampX = -(-dirY) * lateralVel * LATERAL_DAMPING * FIXED_TIMESTEP;
            const latDampY = -(dirX) * lateralVel * LATERAL_DAMPING * FIXED_TIMESTEP;
            const lx = corrX + latDampX;
            const ly = corrY + latDampY;
            shipBody.applyImpulseAtPoint({ x: lx, y: ly }, otherPos, true);
            dcBody.applyImpulseAtPoint({ x: -lx, y: -ly }, dcPos, true);
          }

          break; // One component per ship per side is enough
        }
      }
    }
  }
}

/** Check for docking: low-speed + grid-aligned contact near attractor-mode sides */
export function processDecouplerDocking(sim: BattleSimulation, decouplers: DecouplerState[]) {
  for (const dc of decouplers) {
    const attractorSides = dc.sides.filter(s => s.mode === 'attractor');
    if (attractorSides.length === 0) continue;

    let dcShip: ShipState | undefined;
    let dcComp: ComponentInstance | undefined;
    for (const s of sim.ships) {
      const c = s.components.find(c => c.id === dc.compId);
      if (c) { dcShip = s; dcComp = c; break; }
    }
    if (!dcShip || !dcComp || dcComp.health <= 0) continue;

    const dcBody = sim.world.getRigidBody(dcShip.bodyHandle);
    if (!dcBody) continue;

    const dcCollider = sim.world.getCollider(dcComp.colliderHandle);
    if (!dcCollider) continue;
    const dcPos = dcCollider.translation();
    const dcAngle = dcBody.rotation();

    for (const sideState of attractorSides) {
      const { dirX, dirY, dockX, dockY } = getAttractorSideWorld(dcPos, dcAngle, sideState.side);

      for (const otherShip of sim.ships) {
        if (otherShip === dcShip) continue;
        const otherBody = sim.world.getRigidBody(otherShip.bodyHandle);
        if (!otherBody) continue;

        // Check relative speed
        const v1 = dcBody.linvel();
        const v2 = otherBody.linvel();
        const relSpeed = Math.sqrt(
          (v1.x - v2.x) ** 2 + (v1.y - v2.y) ** 2
        );

        if (relSpeed >= DECOUPLER_DOCK_MAX_SPEED) continue;

        // Find the nearest component on the correct side
        let nearestComp: ComponentInstance | undefined;
        let nearestDist = TILE_SIZE * 1.5;

        for (const otherComp of otherShip.components) {
          if (otherComp.health <= 0) continue;
          const otherColl = sim.world.getCollider(otherComp.colliderHandle);
          if (!otherColl) continue;
          const otherPos = otherColl.translation();

          // Must be on the correct side
          const toCompX = otherPos.x - dcPos.x;
          const toCompY = otherPos.y - dcPos.y;
          if (toCompX * dirX + toCompY * dirY < 0) continue;

          const dist = Math.sqrt(
            (dockX - otherPos.x) ** 2 + (dockY - otherPos.y) ** 2
          );
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestComp = otherComp;
          }
        }

        if (!nearestComp) continue;

        // Check grid alignment: the component must be close to the exact dock point
        const otherColl = sim.world.getCollider(nearestComp.colliderHandle);
        if (!otherColl) continue;
        const otherPos = otherColl.translation();

        // Lateral offset (perpendicular to the dock direction)
        const lateralOffset = Math.abs(
          (otherPos.x - dockX) * (-dirY) + (otherPos.y - dockY) * dirX
        );
        // Longitudinal distance (along dock direction, from dock point)
        const longDist = Math.abs(
          (otherPos.x - dockX) * dirX + (otherPos.y - dockY) * dirY
        );

        // Must be within alignment tolerance to dock
        if (lateralOffset > DOCK_ALIGN_TOLERANCE || longDist > DOCK_ALIGN_TOLERANCE) {
          continue; // Not aligned yet — attraction will keep pulling it in
        }

        // Aligned and close enough — dock!
        mergeBodies(sim, dcShip, otherShip);
        sideState.mode = 'latched';
        dc.bodyHandle = dcComp.bodyHandle;
        // Return immediately — merged bodies invalidate iteration state.
        // Next tick will process remaining decouplers.
        return;
      }
    }
  }
}

/** Merge absorbed ship's components into the surviving ship's body */
function mergeBodies(sim: BattleSimulation, survivor: ShipState, absorbed: ShipState) {
  const survBody = sim.world.getRigidBody(survivor.bodyHandle);
  const absBody = sim.world.getRigidBody(absorbed.bodyHandle);
  if (!survBody || !absBody) return;

  const survHasCM = survivor.components.some(
    c => c.type === ComponentType.CommandModule && c.health > 0
  );
  const absHasCM = absorbed.components.some(
    c => c.type === ComponentType.CommandModule && c.health > 0
  );

  let actualSurvivor = survivor;
  let actualAbsorbed = absorbed;

  if (!survHasCM && absHasCM) {
    actualSurvivor = absorbed;
    actualAbsorbed = survivor;
  } else if (survHasCM === absHasCM) {
    if (absorbed.components.length > survivor.components.length) {
      actualSurvivor = absorbed;
      actualAbsorbed = survivor;
    }
  }

  const survBodyFinal = sim.world.getRigidBody(actualSurvivor.bodyHandle)!;
  const absBodyFinal = sim.world.getRigidBody(actualAbsorbed.bodyHandle)!;

  // Capture masses, velocities, and inertias BEFORE collider transfer
  const survMass = survBodyFinal.mass();
  const absMass = absBodyFinal.mass();
  const survVel = survBodyFinal.linvel();
  const absVel = absBodyFinal.linvel();
  const survAngvel = survBodyFinal.angvel();
  const absAngvel = absBodyFinal.angvel();
  const survInertia = survBodyFinal.principalInertia();
  const absInertia = absBodyFinal.principalInertia();
  const survPosSnap = survBodyFinal.translation();
  const absPosSnap = absBodyFinal.translation();

  // Compute momentum-conserving linear velocity
  const totalMass = survMass + absMass;
  const newVx = (survMass * survVel.x + absMass * absVel.x) / totalMass;
  const newVy = (survMass * survVel.y + absMass * absVel.y) / totalMass;

  // Compute merged COM for angular momentum calculation
  const newComX = (survMass * survPosSnap.x + absMass * absPosSnap.x) / totalMass;
  const newComY = (survMass * survPosSnap.y + absMass * absPosSnap.y) / totalMass;

  // Total angular momentum about the merged COM
  // L = I*ω + m*(r × v)  where × in 2D is rx*vy - ry*vx
  const srx = survPosSnap.x - newComX;
  const sry = survPosSnap.y - newComY;
  const arx = absPosSnap.x - newComX;
  const ary = absPosSnap.y - newComY;
  const totalL = survInertia * survAngvel + absInertia * absAngvel
    + survMass * (srx * survVel.y - sry * survVel.x)
    + absMass * (arx * absVel.y - ary * absVel.x);

  const survAngle = survBodyFinal.rotation();
  const survPos = survBodyFinal.translation();

  const cosS = Math.cos(-survAngle);
  const sinS = Math.sin(-survAngle);

  // Find the survivor's grid anchor by transforming its first component's
  // world position into body-local space
  const survAnchorComp = actualSurvivor.components[0];
  const survAnchorColl = sim.world.getCollider(survAnchorComp.colliderHandle);
  let gridOriginX = survAnchorComp.gridX * TILE_SIZE;
  let gridOriginY = survAnchorComp.gridY * TILE_SIZE;
  if (survAnchorColl) {
    const anchorWorld = survAnchorColl.translation();
    const adx = anchorWorld.x - survPos.x;
    const ady = anchorWorld.y - survPos.y;
    const anchorLocalX = adx * cosS - ady * sinS;
    const anchorLocalY = adx * sinS + ady * cosS;
    gridOriginX = anchorLocalX - survAnchorComp.gridX * TILE_SIZE;
    gridOriginY = anchorLocalY - survAnchorComp.gridY * TILE_SIZE;
  }

  for (const comp of actualAbsorbed.components) {
    const oldCollider = sim.world.getCollider(comp.colliderHandle);
    if (!oldCollider) continue;

    const worldPos = oldCollider.translation();
    const dx = worldPos.x - survPos.x;
    const dy = worldPos.y - survPos.y;
    let localX = dx * cosS - dy * sinS;
    let localY = dx * sinS + dy * cosS;

    // Snap to nearest TILE_SIZE grid aligned with survivor's grid
    localX = Math.round((localX - gridOriginX) / TILE_SIZE) * TILE_SIZE + gridOriginX;
    localY = Math.round((localY - gridOriginY) / TILE_SIZE) * TILE_SIZE + gridOriginY;

    // Update gridX/gridY relative to survivor's grid
    comp.gridX = Math.round((localX - gridOriginX) / TILE_SIZE);
    comp.gridY = Math.round((localY - gridOriginY) / TILE_SIZE);

    sim.world.removeCollider(oldCollider, true);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(TILE_SIZE / 2, TILE_SIZE / 2)
      .setTranslation(localX, localY)
      .setDensity(getComponentDef(comp.type).mass)
      .setFriction(0)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const newCollider = sim.world.createCollider(colliderDesc, survBodyFinal);

    sim.colliderToComponent.delete(comp.colliderHandle);
    comp.colliderHandle = newCollider.handle;
    comp.bodyHandle = survBodyFinal.handle;
    sim.colliderToComponent.set(newCollider.handle, comp);
  }

  if (actualAbsorbed !== absorbed ? survHasCM : absHasCM) {
    for (const comp of actualAbsorbed.components) {
      if (comp.type === ComponentType.CommandModule && comp.health > 0) {
        comp.type = ComponentType.Dummy;
      }
    }
  }

  // Restore owner on absorbed components — they're now part of a controlled ship again
  const survivorOwner = actualSurvivor.components[0]?.owner ?? null;
  for (const comp of actualAbsorbed.components) {
    comp.owner = survivorOwner;
  }

  actualSurvivor.components.push(...actualAbsorbed.components);
  actualAbsorbed.components = [];

  sim.world.removeRigidBody(absBodyFinal);
  sim.ships = sim.ships.filter(s => s !== actualAbsorbed);

  // Set momentum-conserving velocities now that Rapier has updated inertia
  const newInertia = survBodyFinal.principalInertia();
  const newAngvel = newInertia > 0 ? totalL / newInertia : 0;
  survBodyFinal.setLinvel({ x: newVx, y: newVy }, true);
  survBodyFinal.setAngvel(newAngvel, true);

  for (const dc of sim.decouplers) {
    const comp = actualSurvivor.components.find(c => c.id === dc.compId);
    if (comp) {
      dc.bodyHandle = comp.bodyHandle;
    }
  }
}
