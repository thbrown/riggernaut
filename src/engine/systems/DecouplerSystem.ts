import RAPIER from '@dimforge/rapier2d-compat';
import { BattleSimulation, ShipState } from '../BattleSimulation';
import { ComponentInstance } from '../entities/ComponentInstance';
import { ComponentType, Side } from '../../types/components';
import { rotateSide } from '../../types/grid';
import {
  DECOUPLER_DETACH_IMPULSE, FIXED_TIMESTEP,
  DECOUPLER_ATTRACTION_RADIUS,
  DECOUPLER_ATTRACTION_FORCE, DECOUPLER_DOCK_MAX_SPEED, TILE_SIZE,
  ATTRACTOR_ANGULAR_STIFFNESS, ATTRACTOR_ANGULAR_DAMPING, COLLIDER_MARGIN,
} from '../../config/constants';
import { getComponentDef } from '../../game/components';
import { sideOffset, resolveSegmentOwner } from './ConnectivitySystem';
import { splitOrphansToNewBodies } from './BodySplitSystem';
import { ConnectionGraph } from './ConnectionGraph';
import { canAttachRuntime } from './ConnectivitySystem';

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

/** A request to sever a connection, accumulated during pass 1 */
interface SeverRequest {
  compId: string;
  neighborId: string;
  /** World-space impulse direction (unit vector) */
  impulseWorldX: number;
  impulseWorldY: number;
  /** World-space position of the decoupler (for torque application) */
  impulsePointX: number;
  impulsePointY: number;
  /** The ship this decoupler belongs to */
  shipBodyHandle: number;
}

/** Process decoupler hotkey presses — two-pass system:
 *  Pass 1: Collect all sides transitioning to unlatched, record SeverRequests.
 *  Pass 2: Sever edges in graph, detect orphans, split with accumulated impulses. */
export function processDecouplerInput(
  sim: BattleSimulation,
  pressedKeys: Set<string>,
  decouplers: DecouplerState[],
) {
  const severRequests: SeverRequest[] = [];

  // === PASS 1: Collect ===
  for (const dc of decouplers) {
    for (const sideState of dc.sides) {
      if (!sideState.hotkey || !pressedKeys.has(sideState.hotkey)) continue;

      if (sideState.mode === 'latched') {
        // Find ship and component
        let ship: ShipState | undefined;
        let comp: ComponentInstance | undefined;
        for (const s of sim.ships) {
          const c = s.components.find(c => c.id === dc.compId);
          if (c) { ship = s; comp = c; break; }
        }
        if (!ship || !comp) continue;
        if (comp.owner !== 'player') continue;

        // Use the decoupler's actual body (may differ from ship.bodyHandle in hinged ships)
        const body = sim.world.getRigidBody(comp.bodyHandle) ?? sim.world.getRigidBody(ship.bodyHandle);
        if (!body) continue;

        const offset = sideOffset(sideState.side);
        const neighborX = comp.gridX + offset.dx;
        const neighborY = comp.gridY + offset.dy;
        const neighbor = ship.components.find(
          c => c.gridX === neighborX && c.gridY === neighborY && c.health > 0,
        );

        // Mark unlatched
        sideState.mode = 'unlatched';

        // Remove any FixedJoint for this decoupler side (used when decoupler bridges hinge sections)
        const djIdx = sim.decouplerJoints.findIndex(
          dj => dj.compId === dc.compId && dj.side === sideState.side,
        );
        if (djIdx !== -1) {
          const dj = sim.decouplerJoints[djIdx];
          const fixedJoint = sim.world.getImpulseJoint(dj.jointHandle);
          if (fixedJoint) sim.world.removeImpulseJoint(fixedJoint, true);
          sim.decouplerJoints.splice(djIdx, 1);
        }

        if (!neighbor) continue;

        // Compute world-space impulse direction using the decoupler's actual body rotation
        const angle = body.rotation();
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const worldDirX = offset.dx * cos - offset.dy * sin;
        const worldDirY = offset.dx * sin + offset.dy * cos;

        const dcCollider = sim.world.getCollider(comp.colliderHandle);
        const dcWorldPos = dcCollider ? dcCollider.translation() : body.translation();

        severRequests.push({
          compId: dc.compId,
          neighborId: neighbor.id,
          impulseWorldX: worldDirX,
          impulseWorldY: worldDirY,
          impulsePointX: dcWorldPos.x,
          impulsePointY: dcWorldPos.y,
          shipBodyHandle: ship.bodyHandle,
        });
      } else if (sideState.mode === 'unlatched') {
        sideState.mode = 'attractor';
      } else {
        sideState.mode = 'unlatched';
      }
    }
  }

  if (severRequests.length === 0) return;

  // === PASS 2: Apply ===
  // Group sever requests by ship
  const requestsByShip = new Map<number, SeverRequest[]>();
  for (const req of severRequests) {
    let list = requestsByShip.get(req.shipBodyHandle);
    if (!list) {
      list = [];
      requestsByShip.set(req.shipBodyHandle, list);
    }
    list.push(req);
  }

  for (const [shipBodyHandle, requests] of requestsByShip) {
    const ship = sim.ships.find(s => s.bodyHandle === shipBodyHandle);
    if (!ship) continue;

    // Get or create connection graph for this ship
    let graph = sim.connectionGraphs.get(shipBodyHandle);
    if (!graph) {
      // Fallback: build from current state
      const unlatchedSides = new Map<string, Side[]>();
      for (const d of sim.decouplers) {
        const sides = d.sides.filter(s => s.mode !== 'latched').map(s => s.side);
        if (sides.length > 0) unlatchedSides.set(d.compId, sides);
      }
      graph = ConnectionGraph.fromComponents(ship.components, unlatchedSides);
      sim.connectionGraphs.set(shipBodyHandle, graph);
    }

    // Sever all requested edges
    for (const req of requests) {
      graph.sever(req.compId, req.neighborId);
    }

    // Find reachable from anchors
    const reachable = graph.getReachableFromAnchors(ship.components);
    const orphans = ship.components.filter(c => !reachable.has(c.id));

    if (orphans.length === 0) continue;

    // Remove orphans from ship
    ship.components = ship.components.filter(c => reachable.has(c.id));

    // Group orphans into clusters via the graph
    const orphanIds = orphans.map(c => c.id);
    const clusterIds = graph.getConnectedClusters(orphanIds);
    const compById = new Map(orphans.map(c => [c.id, c]));

    // For each cluster, compute accumulated impulse from bordering sever requests
    const clusterComps: ComponentInstance[][] = clusterIds.map(
      ids => ids.map(id => compById.get(id)!),
    );

    // Build cluster membership lookup
    const compToCluster = new Map<string, number>();
    for (let ci = 0; ci < clusterIds.length; ci++) {
      for (const id of clusterIds[ci]) {
        compToCluster.set(id, ci);
      }
    }

    // Accumulate impulse per cluster
    const clusterImpulses: Array<{ fx: number; fy: number; px: number; py: number }> = clusterIds.map(
      () => ({ fx: 0, fy: 0, px: 0, py: 0 }),
    );

    for (const req of requests) {
      // The neighbor is in the orphan side — find which cluster
      const ci = compToCluster.get(req.neighborId);
      if (ci !== undefined) {
        clusterImpulses[ci].fx += req.impulseWorldX * DECOUPLER_DETACH_IMPULSE;
        clusterImpulses[ci].fy += req.impulseWorldY * DECOUPLER_DETACH_IMPULSE;
        clusterImpulses[ci].px += req.impulsePointX;
        clusterImpulses[ci].py += req.impulsePointY;
      }
      // The compId might be in orphan side too (if decoupler itself is orphaned)
      const ci2 = compToCluster.get(req.compId);
      if (ci2 !== undefined) {
        clusterImpulses[ci2].fx += -req.impulseWorldX * DECOUPLER_DETACH_IMPULSE;
        clusterImpulses[ci2].fy += -req.impulseWorldY * DECOUPLER_DETACH_IMPULSE;
        clusterImpulses[ci2].px += req.impulsePointX;
        clusterImpulses[ci2].py += req.impulsePointY;
      }
    }

    // Split orphans using the graph's adjacency
    const adj = graph.toAdjMap();
    splitOrphansToNewBodies(sim, ship, orphans, adj, clusterImpulses);

    // Remove orphan nodes from parent ship's graph
    for (const orphan of orphans) {
      graph.removeComponent(orphan.id);
    }

    // Resolve ownership on new ships using resolveSegmentOwner
    const previousOwner = orphans[0]?.owner ?? null;
    for (const s of sim.ships) {
      if (!orphans.some(o => s.components.includes(o))) continue;
      const newOwner = resolveSegmentOwner(s.components, previousOwner);
      for (const c of s.components) {
        c.owner = newOwner;
      }
      // Create connection graph for the new ship
      const subgraph = ConnectionGraph.fromComponents(s.components);
      sim.connectionGraphs.set(s.bodyHandle, subgraph);
    }

    // Apply reaction impulse to parent ship
    const parentBody = sim.world.getRigidBody(shipBodyHandle);
    if (parentBody) {
      for (const req of requests) {
        // Only apply reaction if the decoupler stayed on the parent
        if (reachable.has(req.compId)) {
          parentBody.applyImpulseAtPoint(
            { x: -req.impulseWorldX * DECOUPLER_DETACH_IMPULSE, y: -req.impulseWorldY * DECOUPLER_DETACH_IMPULSE },
            { x: req.impulsePointX, y: req.impulsePointY },
            true,
          );
        }
      }
    }

    // Apply per-cluster impulses to orphan bodies
    for (let ci = 0; ci < clusterComps.length; ci++) {
      const imp = clusterImpulses[ci];
      if (imp.fx === 0 && imp.fy === 0) continue;
      const clusterComp = clusterComps[ci][0];
      if (!clusterComp) continue;
      const orphanBody = sim.world.getRigidBody(clusterComp.bodyHandle);
      if (orphanBody) {
        const reqCount = requests.filter(r => compToCluster.get(r.neighborId) === ci || compToCluster.get(r.compId) === ci).length;
        const avgPx = reqCount > 0 ? imp.px / reqCount : orphanBody.translation().x;
        const avgPy = reqCount > 0 ? imp.py / reqCount : orphanBody.translation().y;
        orphanBody.applyImpulseAtPoint(
          { x: imp.fx, y: imp.fy },
          { x: avgPx, y: avgPy },
          true,
        );
      }
    }

    // Camera smooth transition if player ship was affected
    if (ship.isPlayer) {
      const comPos = sim.getPlayerBodyPosition();
      if (comPos) sim.camera.onMassChange(comPos);
    }
  }

  // Update decoupler body handles
  for (const dc of decouplers) {
    for (const s of sim.ships) {
      const comp = s.components.find(c => c.id === dc.compId);
      if (comp) {
        dc.bodyHandle = comp.bodyHandle;
        break;
      }
    }
  }
}

/** Exported so component def callback can call this.
 *  Now delegates to the two-pass system via processDecouplerInput. */
export function detachDecouplerSide(sim: BattleSimulation, dc: DecouplerState, sideState: DecouplerSideState) {
  // Create a synthetic pressed-keys set containing this side's hotkey
  // and run through the two-pass system
  if (!sideState.hotkey) {
    sideState.mode = 'unlatched';
    return;
  }
  const pressedKeys = new Set<string>([sideState.hotkey]);
  processDecouplerInput(sim, pressedKeys, [dc]);
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
          // Distance-dependent speed limit: decelerate as section approaches
          const maxSpeed = MAX_APPROACH_SPEED * Math.max(0.2, dist / DECOUPLER_ATTRACTION_RADIUS);
          let fx = 0;
          let fy = 0;
          if (approachSpeed < maxSpeed) {
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

          // Rotational alignment: snap attracted body to nearest 90° relative to decoupler body
          const angleDiff = shipBody.rotation() - dcBody.rotation();
          // Normalize to [-π, π]
          const normAngle = angleDiff - Math.round(angleDiff / (2 * Math.PI)) * 2 * Math.PI;
          const targetAngleDiff = Math.round(normAngle / (Math.PI / 2)) * (Math.PI / 2);
          const angleError = normAngle - targetAngleDiff;
          const relAngvel = shipBody.angvel() - dcBody.angvel();
          const torque = (-ATTRACTOR_ANGULAR_STIFFNESS * angleError - ATTRACTOR_ANGULAR_DAMPING * relAngvel) * FIXED_TIMESTEP;
          shipBody.applyTorqueImpulse(torque, true);
          dcBody.applyTorqueImpulse(-torque, true);

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
    c => getComponentDef(c.type).isConnectivityAnchor && c.health > 0
  );
  const absHasCM = absorbed.components.some(
    c => getComponentDef(c.type).isConnectivityAnchor && c.health > 0
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

    const colliderDesc = RAPIER.ColliderDesc.cuboid(TILE_SIZE / 2 - COLLIDER_MARGIN, TILE_SIZE / 2 - COLLIDER_MARGIN)
      .setTranslation(localX, localY)
      .setDensity(getComponentDef(comp.type).mass)
      .setFriction(0)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const newCollider = sim.world.createCollider(colliderDesc, survBodyFinal);

    sim.colliderToComponent.delete(comp.colliderHandle);
    sim.colliderToShip.delete(comp.colliderHandle);
    comp.colliderHandle = newCollider.handle;
    comp.bodyHandle = survBodyFinal.handle;
    sim.colliderToComponent.set(newCollider.handle, comp);
  }

  if (actualAbsorbed !== absorbed ? survHasCM : absHasCM) {
    for (const comp of actualAbsorbed.components) {
      if (getComponentDef(comp.type).isConnectivityAnchor && comp.health > 0) {
        comp.type = ComponentType.Dummy;
      }
    }
  }

  // Restore owner on absorbed components — they're now part of a controlled ship again
  const survivorOwner = actualSurvivor.components[0]?.owner ?? null;
  for (const comp of actualAbsorbed.components) {
    comp.owner = survivorOwner;
  }

  // Assign random hotkeys to powered components that lack them (player only)
  if (survivorOwner === 'player') {
    const usedKeys = new Set<string>();
    for (const c of [...actualSurvivor.components, ...actualAbsorbed.components]) {
      if (c.hotkey) usedKeys.add(c.hotkey);
    }
    const pool = 'abcdefghijklmnopqrstuvwxyz1234567890'.split('').filter(k => !usedKeys.has(k));
    for (const comp of actualAbsorbed.components) {
      if (getComponentDef(comp.type).hasPower && !comp.hotkey && pool.length > 0) {
        comp.hotkey = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      }
    }
  }

  actualSurvivor.components.push(...actualAbsorbed.components);
  actualAbsorbed.components = [];

  // Update colliderToShip for all components now on the survivor
  for (const comp of actualSurvivor.components) {
    sim.colliderToShip.set(comp.colliderHandle, actualSurvivor);
  }

  // Record killer chain: absorbed body → survivor body (for camera follow)
  sim.killerChain.set(absBodyFinal.handle, actualSurvivor.bodyHandle);

  sim.world.removeRigidBody(absBodyFinal);
  sim.ships = sim.ships.filter(s => s !== actualAbsorbed);

  // Ensure survivor has bodyInterp with current body state
  if (!actualSurvivor.bodyInterp) {
    actualSurvivor.bodyInterp = new Map();
  }
  const survPosNow = survBodyFinal.translation();
  actualSurvivor.bodyInterp.set(survBodyFinal.handle, {
    prevPos: { x: survPosNow.x, y: survPosNow.y },
    prevAngle: survBodyFinal.rotation(),
  });
  // Remove stale entry for absorbed body
  actualSurvivor.bodyInterp.delete(absBodyFinal.handle);

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

  // Phase 6: Merge connection graphs
  const survGraph = sim.connectionGraphs.get(actualSurvivor.bodyHandle);
  const absGraph = sim.connectionGraphs.get(actualAbsorbed.bodyHandle);
  if (survGraph && absGraph) {
    survGraph.mergeFrom(absGraph);
  } else if (!survGraph && absGraph) {
    sim.connectionGraphs.set(actualSurvivor.bodyHandle, absGraph);
  }
  // Rebuild edges between the newly merged components (docking creates new adjacency)
  const mergedGraph = sim.connectionGraphs.get(actualSurvivor.bodyHandle);
  if (mergedGraph) {
    // Ensure all components are nodes
    for (const c of actualSurvivor.components) {
      mergedGraph.addNode(c.id);
    }
    // Add edges for newly adjacent components from the merge
    // (must check attachable sides to avoid connecting e.g. ram tops)
    for (const compA of actualSurvivor.components) {
      for (const compB of actualSurvivor.components) {
        if (compA.id >= compB.id) continue;
        if (mergedGraph.hasEdge(compA.id, compB.id)) continue;
        const dx = Math.abs(compA.gridX - compB.gridX);
        const dy = Math.abs(compA.gridY - compB.gridY);
        if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) {
          if (canAttachRuntime(compA, compB)) {
            mergedGraph.addEdge(compA.id, compB.id);
          }
        }
      }
    }
  }
  // Delete absorbed ship's graph entry
  sim.connectionGraphs.delete(actualAbsorbed.bodyHandle);

  // Camera smooth transition if player ship involved
  if (actualSurvivor.isPlayer) {
    const comPos = sim.getPlayerBodyPosition();
    if (comPos) sim.camera.onMassChange(comPos);
  }
}
